import { profileSlug } from './config.js';
import { sleep, rand, humanScroll, dismissOverlays, isAuthenticated } from './session.js';
import { log } from './logger.js';

/**
 * LinkedIn shows relative ages: "2h", "1d", "3w", "1mo", "2yr", "Just now".
 * Returns minutes, or null when the string can't be parsed.
 */
export function parseAgeMinutes(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/just now|^now\b|\bnow\s*•/.test(s)) return 0;

  const long = s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
  if (long) {
    const n = Number(long[1]);
    const unit = long[2];
    if (unit === 'second') return 0;
    if (unit === 'minute') return n;
    if (unit === 'hour') return n * 60;
    if (unit === 'day') return n * 1440;
    if (unit === 'week') return n * 10080;
    if (unit === 'month') return n * 43200;
    if (unit === 'year') return n * 525600;
  }

  const short = s.match(/(?:^|\s)(\d+)\s*(mo|yr|[smhdwy])(?![a-z])/);
  if (!short) return null;
  const n = Number(short[1]);
  switch (short[2]) {
    case 's': return 0;
    case 'm': return n;
    case 'h': return n * 60;
    case 'd': return n * 1440;
    case 'w': return n * 10080;
    case 'mo': return n * 43200;
    case 'y':
    case 'yr': return n * 525600;
    default: return null;
  }
}

export function activityUrl(profileUrl) {
  return `${profileUrl.replace(/\/$/, '')}/recent-activity/all/`;
}

export function postUrl(urn) {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * Visit one profile's activity feed and return the posts currently visible.
 *
 * Rather than matching container class names — which LinkedIn renames often and
 * without warning — this finds every element carrying an activity ID anywhere
 * in the DOM and walks up to whatever wraps it. That survives layout changes
 * which would break a class-based approach outright.
 */
export async function scrapeProfile(page, profileUrl) {
  const slug = profileSlug(profileUrl);

  await page.goto(activityUrl(profileUrl), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(rand(1500, 2800));

  if (!(await isAuthenticated(page))) throw new Error('SESSION_INVALID');

  await dismissOverlays(page);

  // Wait for post content to arrive rather than guessing with a fixed sleep.
  await page
    .waitForFunction(() => document.body.innerHTML.includes('urn:li:activity'), { timeout: 15000 })
    .catch(() => {});

  await humanScroll(page, rand(2, 4));
  await sleep(rand(700, 1400));

  const raw = await page.evaluate(() => {
    const URN_RE = /urn:li:(?:activity|ugcPost|share):\d+/;

    const readUrn = (el) => {
      for (const attr of ['data-urn', 'data-id', 'data-activity-urn', 'data-chameleon-result-urn', 'href']) {
        const v = el.getAttribute && el.getAttribute(attr);
        const m = v && v.match(URN_RE);
        if (m) return m[0].replace(/urn:li:(?:ugcPost|share):/, 'urn:li:activity:');
      }
      return null;
    };

    // Climb until we reach something big enough to be the whole post block.
    const containerFor = (el) => {
      let node = el;
      for (let i = 0; i < 10 && node.parentElement; i++) {
        const t = (node.innerText || '').trim();
        if (t.length > 80 && node.querySelector('a[href*="/in/"], a[href*="/company/"]')) return node;
        node = node.parentElement;
      }
      return el.closest('li') || el.parentElement || el;
    };

    const pickText = (root, sels) => {
      for (const s of sels) {
        const el = root.querySelector(s);
        const t = el && el.innerText && el.innerText.trim();
        if (t) return t;
      }
      return '';
    };

    // Age: the actor line, then any <time>, then a time pattern near the top of
    // the block, then any aria-label mentioning "ago".
    const pickAge = (root) => {
      const direct = pickText(root, [
        '.update-components-actor__sub-description',
        '.update-components-actor__description',
        '.update-components-actor__sub-description-link',
      ]);
      if (direct) return direct.split('\n')[0];

      const timeEl = root.querySelector('time');
      if (timeEl) return (timeEl.getAttribute('datetime') || timeEl.innerText || '').trim();

      const head = (root.innerText || '').slice(0, 400);
      const m =
        head.match(/(?:^|\s)(\d+\s*(?:mo|yr|[smhdw]))(?=\s*(?:•|·|\n|$))/i) ||
        head.match(/\d+\s*(?:second|minute|hour|day|week|month|year)s?\s+ago/i) ||
        head.match(/just now/i);
      if (m) return m[0].trim();

      for (const el of root.querySelectorAll('[aria-label]')) {
        const l = el.getAttribute('aria-label');
        if (l && /ago\b/i.test(l)) return l;
      }
      return '';
    };

    const out = new Map();
    const candidates = document.querySelectorAll(
      '[data-urn],[data-id],[data-activity-urn],[data-chameleon-result-urn],a[href*="urn:li:activity"]'
    );

    for (const el of candidates) {
      const urn = readUrn(el);
      if (!urn || out.has(urn)) continue;

      const root = containerFor(el);
      const blockText = root.innerText || '';

      out.set(urn, {
        urn,
        author:
          pickText(root, ['.update-components-actor__title', '.update-components-actor__name']).split('\n')[0] || '',
        text: pickText(root, [
          '.update-components-text',
          '.feed-shared-inline-show-more-text',
          '.feed-shared-update-v2__description',
          '.update-components-update-v2__commentary',
        ]),
        ageRaw: pickAge(root),
        isRepost: /reposted this|shared this/i.test(blockText.slice(0, 400)),
        isPromoted: /\bpromoted\b/i.test(blockText.slice(0, 200)),
        blockLength: blockText.length,
      });
    }

    return {
      posts: [...out.values()],
      sawUrnInHtml: document.body.innerHTML.includes('urn:li:activity'),
    };
  });

  if (!raw.posts.length && raw.sawUrnInHtml) {
    log.warn(`${slug}: page contains posts but none could be read — selectors may need updating`);
  }

  return raw.posts
    .filter((p) => p.blockLength > 60)
    .map((p) => ({
      ...p,
      profile: profileUrl,
      slug,
      ageMinutes: parseAgeMinutes(p.ageRaw),
      text: (p.text || '').replace(/\s*…\s*see more\s*$/i, '').trim(),
    }));
}
