import assert from 'node:assert';
import { parseAgeMinutes } from './src/scraper.js';
import { prefilter, checkComment } from './src/generator.js';
import { db } from './src/db.js';
import { normaliseProfileUrl } from './src/config.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); pass++; } catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; } };

console.log('\nage parsing');
t('2h', () => assert.equal(parseAgeMinutes('2h •'), 120));
t('1d', () => assert.equal(parseAgeMinutes('1d • Edited'), 1440));
t('3w', () => assert.equal(parseAgeMinutes('3w'), 30240));
t('1mo', () => assert.equal(parseAgeMinutes('1mo •'), 43200));
t('just now', () => assert.equal(parseAgeMinutes('Just now'), 0));
t('unparseable returns null', () => assert.equal(parseAgeMinutes('hace 2 horas'), null));
t('long form: 3 hours ago', () => assert.equal(parseAgeMinutes('3 hours ago'), 180));
t('long form: 2 days ago', () => assert.equal(parseAgeMinutes('2 days ago'), 2880));
t('long form: 1 week ago', () => assert.equal(parseAgeMinutes('1 week ago'), 10080));
t('aria label form', () => assert.equal(parseAgeMinutes('Alice Example posted 5 hours ago'), 300));
t('does not misread a word starting with m', () => assert.equal(parseAgeMinutes('12 members'), null));

console.log('\nurl normalising');
t('strips query', () => assert.equal(normaliseProfileUrl('https://linkedin.com/in/john-doe-123/?trk=xyz'), 'https://www.linkedin.com/in/john-doe-123'));
t('rejects non-profile', () => assert.equal(normaliseProfileUrl('https://example.com'), null));

console.log('\nprefilter');
const base = { text: 'x'.repeat(300), ageMinutes: 60, isRepost: false, isPromoted: false };
t('passes a normal post', () => assert.equal(prefilter(base).skip, false));
t('blocks bereavement', () => assert.equal(prefilter({ ...base, text: 'My father passed away last week. ' + 'x'.repeat(200) }).reason, 'sensitive topic'));
t('blocks layoffs', () => assert.equal(prefilter({ ...base, text: 'I was laid off on Friday after four years. ' + 'x'.repeat(200) }).reason, 'sensitive topic'));
t('blocks open to work', () => assert.equal(prefilter({ ...base, text: 'I am open to work and looking for a new role. ' + 'x'.repeat(200) }).reason, 'sensitive topic'));
t('blocks old posts', () => assert.ok(prefilter({ ...base, ageMinutes: 60 * 24 * 30 }).reason.startsWith('too_old')));
t('UNKNOWN AGE NO LONGER KILLS A NEW POST', () => assert.equal(prefilter({ ...base, ageMinutes: null }).skip, false));
t('blocks reposts', () => assert.equal(prefilter({ ...base, isRepost: true }).reason, 'repost'));
t('blocks short posts', () => assert.ok(prefilter({ ...base, text: 'nice' }).reason.startsWith('post too short')));
t('blocks hiring ads', () => assert.equal(prefilter({ ...base, text: 'We are hiring a senior engineer. ' + 'x'.repeat(200) }).reason, 'job ad or engagement bait'));
t('skip reasons are human readable', () => {
  const r = prefilter({ ...base, text: 'My father passed away. ' + 'x'.repeat(200) }).reason;
  assert.ok(!r.includes('_'), 'reason still contains underscores: ' + r);
});

console.log('\ncomment guardrails');
t('accepts a good one', () => assert.ok(checkComment('The measurement angle here is the part most teams skip').ok));
t('adds terminal period', () => assert.equal(checkComment('The measurement angle here is what most teams skip').comment.endsWith('.'), true));
t('rejects banned opener', () => assert.equal(checkComment('Great post, really useful stuff here for everyone').reason, 'banned_opener'));
t('rejects banned phrase', () => assert.equal(checkComment('Honestly this one really resonates with my own experience').reason, 'banned_phrase'));
t('rejects emoji', () => assert.equal(checkComment('Solid framing on the tradeoff you describe here 🔥').reason, 'contains_emoji'));
t('rejects links', () => assert.equal(checkComment('Reminds me of the piece at https://example.com about scaling').reason, 'contains_link'));
t('rejects hashtags', () => assert.equal(checkComment('Sharp point about the deployment bottleneck #devops now').reason, 'contains_mention_or_hashtag'));
t('rejects exclamation', () => assert.equal(checkComment('Sharp point about the deployment bottleneck you raise!').reason, 'contains_exclamation'));
t('rejects invented stats', () => assert.equal(checkComment('Matches the 40% drop most teams see in production').reason, 'contains_statistic'));
t('rejects too long', () => assert.ok(checkComment('word '.repeat(40)).reason.startsWith('too_')));
t('rejects too short', () => assert.ok(checkComment('Nice one').reason.startsWith('too_')));

console.log('\nstore');
db.reset();
t('insertIfNew is idempotent', () => {
  assert.equal(db.insertIfNew('urn:li:activity:1', { status: 'detected' }), true);
  assert.equal(db.insertIfNew('urn:li:activity:1', { status: 'detected' }), false);
});
t('daily count starts empty', () => assert.equal(db.postedToday().length, 0));
t('counts posted today', () => {
  db.update('urn:li:activity:1', { status: 'posted', commentedAt: Date.now(), comment: 'A perfectly reasonable line here.' });
  assert.equal(db.postedToday().length, 1);
});
t('duplicate detection works', () => assert.equal(checkComment('A perfectly reasonable line here.').reason, 'duplicate_of_recent'));
db.reset();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
