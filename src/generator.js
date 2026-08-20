import { config } from './config.js';
import { db } from './db.js';
import { log } from './logger.js';

/* ------------------------------------------------------------------ *
 * 1. Prefilter — cheap, deterministic, runs before any model is called
 * ------------------------------------------------------------------ */

// Posts where a stranger's breezy one-liner would land badly. Edit freely;
// erring toward too many skips costs nothing, erring the other way is the
// failure that ends the project.
const SENSITIVE = [
  /\b(passed away|rest in peace|\brip\b|condolence|funeral|obituar|bereave|memoriam)\b/i,
  /\b(cancer|chemo|diagnos(ed|is)|hospital(ised|ized)?|surgery|icu|terminal illness|palliative)\b/i,
  /\b(laid off|layoffs?|redundanc|let go from|lost my job|made redundant|downsiz)\b/i,
  /\b(open to work|opentowork|actively seeking|looking for (a )?(new )?(role|job|opportunit)|job hunt)\b/i,
  /\b(divorce|miscarr|suicide|self.?harm|depress(ion|ed)|mental health crisis|burnout leave)\b/i,
  /\b(war|genocide|airstrike|shooting|terror|massacre|earthquake|famine|refugee crisis)\b/i,
  /\b(lawsuit|sued|litigation|indict|fraud charges|bankrupt|insolvenc|winding up)\b/i,
  /\b(harassment|assault|discriminat(ion|ed)|racis[tm]|sexis[tm])\b/i,
];

const LOW_VALUE = [
  /\b(we'?re|we are|i'?m|i am|now)\s+hiring\b/i,
  /\b(hiring|job) alert\b/i,
  /\bapply (now|here|via)\b/i,
  /\b(giveaway|tag \d+ friends|comment .{0,12}(below|for the link)|dm me .{0,12}for)\b/i,
  /^(agree\?|thoughts\?|poll:)/i,
];

/**
 * @returns {{skip: boolean, reason?: string}}
 */
export function prefilter(post) {
  const text = post.text || '';

  if (post.isPromoted) return { skip: true, reason: 'promoted' };
  if (config.skipReposts && post.isRepost) return { skip: true, reason: 'repost' };

  // An unreadable age used to skip the post outright, which meant one selector
  // change silently discarded everything. Anything reaching this point was
  // detected *after* the profile was bootstrapped, so the store already proves
  // it is new — that is stronger evidence than the age label anyway.
  if (post.ageMinutes !== null && post.ageMinutes > config.maxPostAgeMinutes) {
    return { skip: true, reason: `too_old (${Math.round(post.ageMinutes / 60)}h)` };
  }
  if (text.length < config.minPostChars) {
    return { skip: true, reason: `post too short (${text.length} chars)` };
  }
  for (const re of SENSITIVE) {
    if (re.test(text)) return { skip: true, reason: 'sensitive topic' };
  }
  for (const re of LOW_VALUE) {
    if (re.test(text)) return { skip: true, reason: 'job ad or engagement bait' };
  }
  return { skip: false };
}

/* ------------------------------------------------------------------ *
 * 2. Prompt
 * ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You write short LinkedIn comments in the voice of a real professional who read the post properly and had one specific thought about it.

You reply with a JSON object and nothing else. No prose, no markdown fences.

Schema:
{"should_comment": boolean, "reason": string, "comment": string}

Set should_comment to false when the post involves: death, illness, injury, bereavement, layoffs, job loss, someone asking for work, politics, religion, war, disasters, legal trouble, harassment, or anything where a stranger's brief comment would be intrusive or tone-deaf. Also false for pure job ads, giveaways, engagement bait, and posts too thin to say anything specific about. When in doubt, choose false.

When should_comment is true, write ONE sentence that:
- responds to the specific claim or detail in this post, not the general topic
- adds an angle, a small extension, or names precisely what is useful about it
- sounds like someone typed it in fifteen seconds
- is between 6 and 20 words
- never opens with: Great, Love, This, So true, Couldn't, Absolutely, Well said, Spot on, Amazing, Incredible
- contains no emoji, hashtags, links, @mentions or exclamation marks
- states no statistics, facts, or attributions you cannot verify from the post itself
- does not ask the author to do anything or pitch anything`;

function userPrompt(post, recent) {
  const avoid = recent.length
    ? `\n\nComments you have already used recently. Do not reuse their structure or opening:\n${recent.slice(0, 12).map((c) => `- ${c}`).join('\n')}`
    : '';
  return `Author: ${post.author || 'unknown'}\n\nPost:\n"""\n${(post.text || '').slice(0, 3000)}\n"""${avoid}`;
}

/* ------------------------------------------------------------------ *
 * 3. Providers — all have a free tier or run locally
 * ------------------------------------------------------------------ */

function extractJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callGroq(post, recent) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.groqKey}`,
    },
    body: JSON.stringify({
      model: config.llm.groqModel,
      temperature: 0.8,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(post, recent) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content);
}

async function callGemini(post, recent) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.llm.geminiModel}:generateContent?key=${config.llm.geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt(post, recent) }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 300, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function callOllama(post, recent) {
  const res = await fetch(`${config.llm.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.llm.ollamaModel,
      stream: false,
      format: 'json',
      options: { temperature: 0.8 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(post, recent) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.message?.content);
}

/**
 * No-LLM fallback. Picks a template keyed off words actually present in the
 * post, so it is at least topical. Noticeably worse than a model — use it to
 * get the pipeline working end to end, not as the final state.
 */
const TEMPLATES = [
  { match: /\b(data|metric|number|benchmark|measur)/i, lines: [
    'The measurement angle here is the part most teams skip entirely.',
    'Useful framing, particularly the bit about what actually gets tracked.',
  ]},
  { match: /\b(hiring|team|culture|manager|leadership)/i, lines: [
    'The second point applies well beyond hiring, in my experience.',
    'Worth separating the process problem from the people problem here.',
  ]},
  { match: /\b(ai|llm|model|agent|automation)/i, lines: [
    'The constraint you describe is more interesting than the capability itself.',
    'This matches what I keep seeing once these systems hit real workloads.',
  ]},
  { match: /\b(product|launch|customer|user|feedback)/i, lines: [
    'The feedback loop you describe is where most of this quietly breaks.',
    'Good distinction between what users ask for and what they do.',
  ]},
];

const GENERIC = [
  'The middle section is the part I had not considered properly.',
  'Clear way of putting something that usually gets overcomplicated.',
  'Interesting that the tradeoff shows up so consistently across contexts.',
];

function callTemplate(post) {
  const text = post.text || '';
  const pool = TEMPLATES.find((t) => t.match.test(text))?.lines || GENERIC;
  const recent = new Set(db.recentComments(30));
  const fresh = pool.filter((l) => !recent.has(l));
  const pick = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
  return { should_comment: true, reason: 'template', comment: pick };
}

/* ------------------------------------------------------------------ *
 * 4. Guardrails — the model's output is a suggestion, not a decision
 * ------------------------------------------------------------------ */

const BANNED_OPENERS = /^(great|love|this|so true|couldn'?t|absolutely|amazing|incredible|well said|spot on|thanks for sharing|totally|100)/i;
const BANNED_PHRASES = [
  /\bwell said\b/i,
  /\bspot on\b/i,
  /\bresonate[sd]?\b/i,
  /\bcouldn'?t agree more\b/i,
  /\bthanks for sharing\b/i,
  /\bgreat (post|insight|point|read|share|take)\b/i,
  /\bvaluable insights?\b/i,
  /\bgame.?changer\b/i,
  /\bfood for thought\b/i,
  /\bnail(ed)? it\b/i,
  /\bwell articulated\b/i,
  /\bas an ai\b/i,
];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/u;

/**
 * @returns {{ok: boolean, reason?: string, comment?: string}}
 */
export function checkComment(raw) {
  let c = String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
  if (!c) return { ok: false, reason: 'empty' };

  const words = c.split(/\s+/).length;
  const { minChars, maxChars, minWords, maxWords } = config.comment;

  if (c.length < minChars) return { ok: false, reason: `too_short_${c.length}c` };
  if (c.length > maxChars) return { ok: false, reason: `too_long_${c.length}c` };
  if (words < minWords) return { ok: false, reason: `too_few_words_${words}` };
  if (words > maxWords) return { ok: false, reason: `too_many_words_${words}` };
  if (EMOJI.test(c)) return { ok: false, reason: 'contains_emoji' };
  if (/https?:\/\/|www\./i.test(c)) return { ok: false, reason: 'contains_link' };
  if (/[@#]/.test(c)) return { ok: false, reason: 'contains_mention_or_hashtag' };
  if (/!/.test(c)) return { ok: false, reason: 'contains_exclamation' };
  if (BANNED_OPENERS.test(c)) return { ok: false, reason: 'banned_opener' };
  for (const re of BANNED_PHRASES) {
    if (re.test(c)) return { ok: false, reason: 'banned_phrase' };
  }
  // A number the model invented is the most likely way to say something false.
  if (/\b\d+(\.\d+)?\s*(%|percent|x\b|billion|million|bn|k\b)/i.test(c)) {
    return { ok: false, reason: 'contains_statistic' };
  }
  if (db.recentComments(40).includes(c)) {
    return { ok: false, reason: 'duplicate_of_recent' };
  }

  if (!/[.?]$/.test(c)) c += '.';
  return { ok: true, comment: c };
}

/* ------------------------------------------------------------------ *
 * 5. Public entry point
 * ------------------------------------------------------------------ */

export async function generateComment(post) {
  const pre = prefilter(post);
  if (pre.skip) return { skip: true, reason: pre.reason };

  const recent = db.recentComments(20);
  const provider = config.llm.provider;

  let result = null;
  const attempts = provider === 'template' ? 1 : 2;

  for (let i = 0; i < attempts; i++) {
    try {
      if (provider === 'groq') result = await callGroq(post, recent);
      else if (provider === 'gemini') result = await callGemini(post, recent);
      else if (provider === 'ollama') result = await callOllama(post, recent);
      else result = callTemplate(post);
    } catch (err) {
      log.warn(`LLM call failed (${provider}, attempt ${i + 1}): ${err.message}`);
      continue;
    }

    if (!result) continue;
    if (result.should_comment === false) {
      return { skip: true, reason: `writer declined: ${result.reason || 'no reason given'}` };
    }

    const check = checkComment(result.comment);
    if (check.ok) return { skip: false, comment: check.comment };

    log.warn(`Guardrail rejected "${result.comment}" (${check.reason})`);
    result = null;
  }

  return { skip: true, reason: 'no comment passed the quality checks' };
}
