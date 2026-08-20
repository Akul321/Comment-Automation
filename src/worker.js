import { config, profileSlug } from './config.js';
import { readProfiles } from './settings.js';
import { db } from './db.js';
import { log } from './logger.js';
import { launch, saveSession, hasSession, isAuthenticated, loginStage, sleep, rand, jitter } from './session.js';
import { scrapeProfile } from './scraper.js';
import { generateComment } from './generator.js';
import { postComment } from './commenter.js';

/* ------------------------------- state -------------------------------- */

const EVENTS_MAX = 300;
const events = [];

export const state = {
  running: false,
  phase: 'idle', // idle | scanning | posting | sleeping
  currentProfile: null,
  lastRunAt: null,
  nextRunAt: null,
  postedThisRun: 0,
  loginStatus: hasSession() ? 'saved' : 'none', // none | opening | waiting | saved | failed
  loginMessage: hasSession() ? 'Signed in on this device.' : '',
  loginAt: null,
  lastError: null,
};

export function pushEvent(level, message) {
  events.push({ at: Date.now(), level, message });
  if (events.length > EVENTS_MAX) events.shift();
  log[level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info'](message);
}

export function getEvents(since = 0) {
  return events.filter((e) => e.at > since);
}

/* ----------------------------- login task ----------------------------- */

let loginBrowser = null;

export async function startLogin() {
  if (state.loginStatus === 'opening' || state.loginStatus === 'waiting') {
    return { alreadyRunning: true };
  }
  state.loginStatus = 'opening';
  state.loginMessage = 'Opening a browser window…';
  pushEvent('info', 'Opening a browser window for LinkedIn sign-in');

  (async () => {
    let browser;
    try {
      const launched = await launch({ forLogin: true });
      browser = launched.browser;
      loginBrowser = browser;
      const page = await launched.context.newPage();
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

      state.loginStatus = 'waiting';
      state.loginMessage = 'Enter your email and password in the browser window.';
      pushEvent('info', 'Waiting for you to sign in. This app never touches the password field.');

      const deadline = Date.now() + 10 * 60 * 1000;
      let lastStage = '';
      let ok = false;

      while (Date.now() < deadline) {
        await sleep(1200);

        if (!browser.isConnected() || page.isClosed()) {
          state.loginStatus = hasSession() ? 'saved' : 'failed';
          state.loginMessage = hasSession()
            ? 'Signed in on this device.'
            : 'The window was closed before sign-in finished. Nothing was saved.';
          pushEvent('warn', state.loginMessage);
          return;
        }

        const { stage, message } = await loginStage(page);

        // Narrate each new stage so the window never looks stuck.
        if (stage !== lastStage) {
          lastStage = stage;
          state.loginMessage = message;
          if (stage !== 'done') pushEvent('info', message);
        }

        if (stage === 'done' && (await isAuthenticated(page))) {
          ok = true;
          break;
        }
      }

      if (ok) {
        await sleep(1200);
        await saveSession(launched.context);
        state.loginStatus = 'saved';
        state.loginAt = Date.now();
        state.loginMessage = 'Signed in. You can close the browser window.';
        pushEvent('ok', 'Signed in successfully. Session saved to this device.');

        // Confirm inside the browser window too, so it is obvious there without
        // switching back to the dashboard to find out.
        await page
          .evaluate(() => {
            const el = document.createElement('div');
            el.textContent = 'Signed in. You can close this window and go back to the dashboard.';
            el.setAttribute(
              'style',
              'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
                'justify-content:center;background:#0f6e56;color:#fff;text-align:center;padding:40px;' +
                'font:500 22px/1.5 system-ui,sans-serif'
            );
            document.body.appendChild(el);
          })
          .catch(() => {});
        await sleep(4000);
      } else {
        state.loginStatus = 'failed';
        state.loginMessage = 'Sign-in did not finish in time. Nothing was saved — press Sign in to try again.';
        pushEvent('warn', state.loginMessage);
      }
    } catch (err) {
      state.loginStatus = 'failed';
      state.loginMessage = `Sign-in failed: ${err.message}`;
      pushEvent('error', state.loginMessage);
    } finally {
      if (browser) await browser.close().catch(() => {});
      loginBrowser = null;
    }
  })();

  return { started: true };
}


/* ---------------------------- pacing guards --------------------------- */

export function dailyBudgetLeft() {
  return Math.max(0, config.maxCommentsPerDay - db.postedToday().length);
}

export function cooldownRemainingMs() {
  const last = db.lastCommentedAt();
  if (!last) return 0;
  return Math.max(0, config.minMinutesBetweenComments * 60 * 1000 - (Date.now() - last));
}

/** Everything holding up the next comment, in plain language for the UI. */
export function blockers() {
  const out = [];
  if (dailyBudgetLeft() <= 0) {
    out.push(`Daily limit of ${config.maxCommentsPerDay} reached, resets at midnight`);
  }
  const cd = cooldownRemainingMs();
  if (cd > 0) out.push(`Next comment in ${Math.ceil(cd / 60000)} min`);
  return out;
}

/* ------------------------------ scan phase ---------------------------- */

async function scanProfiles(page) {
  const profiles = readProfiles();
  for (const profileUrl of profiles) {
    if (!state.running) return;
    const slug = profileSlug(profileUrl);
    state.currentProfile = slug;

    let posts = [];
    try {
      posts = await scrapeProfile(page, profileUrl);
    } catch (err) {
      if (err.message === 'SESSION_INVALID') throw err;
      pushEvent('warn', `${slug}: could not be checked — ${err.message}`);
      await sleep(jitter(15000));
      continue;
    }

    db.touchProfile(profileUrl, { lastPostCount: posts.length });

    if (!db.isBootstrapped(profileUrl)) {
      let n = 0;
      for (const p of posts) {
        if (db.insertIfNew(p.urn, { ...p, status: 'backfill', skipReason: 'first_run_backfill' })) n++;
      }
      db.markBootstrapped(profileUrl);
      pushEvent('info', `${slug}: added. ${n} existing posts recorded and skipped — only new posts from now on.`);
      await sleep(jitter(rand(10000, 22000)));
      continue;
    }

    const fresh = posts.filter((p) => db.insertIfNew(p.urn, { ...p, status: 'detected' }));

    // Always report what was seen. Silence here made a broken scraper look
    // identical to a quiet week.
    if (!posts.length) {
      pushEvent('warn', `${slug}: no posts could be read from the page`);
    } else if (!fresh.length) {
      pushEvent('info', `${slug}: ${posts.length} posts on page, none new`);
    } else {
      pushEvent('ok', `${slug}: ${fresh.length} new post${fresh.length > 1 ? 's' : ''} of ${posts.length} on page`);
    }

    for (const post of fresh) {
      const result = await generateComment(post);
      if (result.skip) {
        db.update(post.urn, { status: 'skipped', skipReason: result.reason });
        pushEvent('info', `${slug}: skipped — ${result.reason}`);
        continue;
      }
      db.update(post.urn, {
        status: config.requireApproval ? 'pending' : 'approved',
        comment: result.comment,
      });
      pushEvent('ok', `${slug}: drafted "${result.comment}"`);
    }

    await sleep(jitter(rand(12000, 28000)));
  }
  state.currentProfile = null;
}

/* ------------------------------ post phase ---------------------------- */

async function postApproved(page) {
  const queue = db.byStatus('approved');
  if (!queue.length) return;

  for (const item of queue) {
    if (!state.running) return;
    if (blockers().length) {
      pushEvent('info', `${queue.length} comment${queue.length > 1 ? 's' : ''} queued — ${blockers().join('; ')}`);
      return;
    }
    if (state.postedThisRun >= config.maxCommentsPerRun) return;

    const lag = rand(config.commentDelayMinSeconds * 1000, config.commentDelayMaxSeconds * 1000);
    pushEvent('info', `Waiting ${Math.round(lag / 1000)}s before commenting`);
    await sleep(lag);
    if (!state.running) return;

    try {
      const res = await postComment(page, item.urn, item.comment);
      if (res.posted) {
        db.update(item.urn, { status: 'posted', commentedAt: Date.now(), device: config.deviceName });
        state.postedThisRun++;
        pushEvent('ok', `Commented on ${item.slug || item.urn}`);
      } else {
        const attempts = (db.get(item.urn)?.attempts || 0) + 1;
        db.update(item.urn, {
          status: attempts >= 3 ? 'failed' : 'approved',
          attempts,
          lastError: res.reason,
        });
        pushEvent('warn', `Not posted — ${res.reason}`);
      }
    } catch (err) {
      if (err.message === 'SESSION_INVALID') throw err;
      db.update(item.urn, {
        attempts: (db.get(item.urn)?.attempts || 0) + 1,
        lastError: err.message,
      });
      pushEvent('warn', `Not posted — ${err.message}`);
    }
  }
}

/* ------------------------------- one pass ----------------------------- */

export async function runPass() {
  if (!hasSession()) {
    pushEvent('warn', 'Not signed in to LinkedIn yet.');
    return;
  }
  if (!readProfiles().length) {
    pushEvent('warn', 'No profiles to watch yet.');
    return;
  }

  state.postedThisRun = 0;
  const { browser, context } = await launch();
  const page = await context.newPage();

  try {
    state.phase = 'scanning';
    await scanProfiles(page);
    state.phase = 'posting';
    await postApproved(page);
    state.lastRunAt = Date.now();
  } catch (err) {
    if (err.message === 'SESSION_INVALID') {
      state.loginStatus = 'none';
      state.lastError = 'LinkedIn session expired. Sign in again.';
      pushEvent('error', state.lastError);
      state.running = false;
    } else {
      state.lastError = err.message;
      pushEvent('error', `Run stopped: ${err.message}`);
    }
  } finally {
    await browser.close().catch(() => {});
    state.phase = state.running ? 'sleeping' : 'idle';
  }
}

/* --------------------------- loop control ----------------------------- */

let loopHandle = null;

export function startWorker() {
  if (state.running) return false;
  state.running = true;
  state.lastError = null;
  pushEvent('ok', config.requireApproval
    ? 'Watching for new posts. Drafts will wait for you to approve them.'
    : 'Watching for new posts. Comments will go out automatically.');

  (async () => {
    while (state.running) {
      await runPass();
      if (!state.running) break;
      const wait = jitter(config.pollMinutes * 60 * 1000, 0.35);
      state.nextRunAt = Date.now() + wait;
      state.phase = 'sleeping';
      const step = 2000;
      for (let waited = 0; waited < wait && state.running; waited += step) {
        await sleep(step);
      }
    }
    state.phase = 'idle';
    state.nextRunAt = null;
  })();

  return true;
}

export function stopWorker() {
  if (!state.running) return false;
  state.running = false;
  state.phase = 'idle';
  state.nextRunAt = null;
  pushEvent('info', 'Stopping after the current step');
  return true;
}

export async function scanNow() {
  if (state.phase === 'scanning' || state.phase === 'posting') return false;
  const wasRunning = state.running;
  state.running = true;
  await runPass();
  state.running = wasRunning;
  return true;
}
