import { config, loadProfiles, profileSlug } from './config.js';
import { db } from './db.js';
import { log } from './logger.js';
import { launch, hasSession, sleep, rand, jitter } from './session.js';
import { scrapeProfile } from './scraper.js';
import { generateComment } from './generator.js';
import { postComment } from './commenter.js';

/* ---------------------------- pacing guards ---------------------------- */

function dailyBudgetLeft() {
  return Math.max(0, config.maxCommentsPerDay - db.postedToday().length);
}

function cooldownRemainingMs() {
  const last = db.lastCommentedAt();
  if (!last) return 0;
  const elapsed = Date.now() - last;
  const required = config.minMinutesBetweenComments * 60 * 1000;
  return Math.max(0, required - elapsed);
}

/* ------------------------------- one pass ------------------------------ */

async function runOnce() {
  const profiles = loadProfiles();
  if (!profiles.length) {
    log.error('No profiles found. Add LinkedIn profile URLs to profiles.txt, one per line.');
    return;
  }
  if (!hasSession()) {
    log.error('No saved session. Run: npm run login');
    return;
  }

  log.info(
    `Run starting — ${profiles.length} profiles | provider=${config.llm.provider} | ` +
      `budget left today: ${dailyBudgetLeft()}`
  );

  const { browser, context } = await launch();
  const page = await context.newPage();
  let postedThisRun = 0;

  try {
    for (const profileUrl of profiles) {
      const slug = profileSlug(profileUrl);

      let posts = [];
      try {
        posts = await scrapeProfile(page, profileUrl);
      } catch (err) {
        if (err.message === 'SESSION_INVALID') {
          log.error('Session is no longer valid. Run: npm run login');
          break;
        }
        log.warn(`${slug}: scrape failed — ${err.message}`);
        await sleep(jitter(20000));
        continue;
      }

      db.touchProfile(profileUrl, { lastPostCount: posts.length });

      // ---- first sight of a profile: record everything, comment on nothing.
      if (!db.isBootstrapped(profileUrl)) {
        let n = 0;
        for (const p of posts) {
          if (db.insertIfNew(p.urn, { ...p, status: 'backfill', skipReason: 'first_run_backfill' })) n++;
        }
        db.markBootstrapped(profileUrl);
        log.info(`${slug}: bootstrapped with ${n} existing posts (none will be commented on)`);
        await sleep(jitter(rand(12000, 25000)));
        continue;
      }

      const fresh = posts.filter((p) => db.insertIfNew(p.urn, { ...p, status: 'detected' }));
      if (!fresh.length) {
        log.info(`${slug}: nothing new`);
        await sleep(jitter(rand(12000, 25000)));
        continue;
      }
      log.ok(`${slug}: ${fresh.length} new post(s)`);

      for (const post of fresh) {
        const result = await generateComment(post);

        if (result.skip) {
          db.update(post.urn, { status: 'skipped', skipReason: result.reason });
          log.info(`  skip ${post.urn} — ${result.reason}`);
          continue;
        }

        db.update(post.urn, { status: 'drafted', comment: result.comment });
        log.ok(`  draft ${post.urn}: "${result.comment}"`);

        // ---- pacing checks, evaluated fresh for every single comment
        if (dailyBudgetLeft() <= 0) {
          log.info('  holding — daily cap reached');
          continue;
        }
        if (postedThisRun >= config.maxCommentsPerRun) {
          log.info('  holding — per-run cap reached');
          continue;
        }
        const cooldown = cooldownRemainingMs();
        if (cooldown > 0) {
          log.info(`  holding — ${Math.ceil(cooldown / 60000)}m left on cooldown`);
          continue;
        }

        // Deliberate lag so the comment does not appear seconds after the post.
        const lag = rand(config.commentDelayMinSeconds * 1000, config.commentDelayMaxSeconds * 1000);
        log.info(`  waiting ${Math.round(lag / 1000)}s before commenting`);
        await sleep(lag);

        try {
          const res = await postComment(page, post.urn, result.comment);
          if (res.posted) {
            db.update(post.urn, { status: 'posted', commentedAt: Date.now() });
            postedThisRun++;
          } else {
            const attempts = (db.get(post.urn)?.attempts || 0) + 1;
            db.update(post.urn, {
              status: attempts >= 3 ? 'failed' : 'drafted',
              attempts,
              lastError: res.reason,
            });
            log.warn(`  not posted — ${res.reason}`);
          }
        } catch (err) {
          if (err.message === 'SESSION_INVALID') {
            log.error('Session expired mid-run. Run: npm run login');
            throw err;
          }
          db.update(post.urn, {
            status: 'drafted',
            attempts: (db.get(post.urn)?.attempts || 0) + 1,
            lastError: err.message,
          });
          log.warn(`  post error — ${err.message}`);
        }
      }

      await sleep(jitter(rand(15000, 35000)));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log.info(`Run finished — ${postedThisRun} comment(s) posted this run`);
}

/* -------------------------------- CLI --------------------------------- */

function printStatus() {
  const counts = db.counts();
  const profiles = loadProfiles();
  log.plain('');
  log.plain(`  Profiles watched      ${profiles.length}`);
  log.plain(`  LLM provider          ${config.llm.provider}`);
  log.plain(`  Comments today        ${db.postedToday().length} / ${config.maxCommentsPerDay}`);
  log.plain('');
  log.plain('  Posts by status');
  for (const [k, v] of Object.entries(counts).sort()) {
    log.plain(`    ${k.padEnd(12)} ${v}`);
  }
  log.plain('');
  const drafted = db.byStatus('drafted').slice(-10);
  if (drafted.length) {
    log.plain('  Latest drafts');
    for (const d of drafted) log.plain(`    ${d.slug || ''} — "${d.comment}"`);
    log.plain('');
  }
}

async function watch() {
  for (;;) {
    try {
      await runOnce();
    } catch (err) {
      log.error(`Run aborted: ${err.message}`);
    }
    const wait = jitter(config.pollMinutes * 60 * 1000, 0.35);
    log.info(`Sleeping ${Math.round(wait / 60000)} minutes`);
    await sleep(wait);
  }
}

const cmd = process.argv[2] || 'once';

switch (cmd) {
  case 'once':
    await runOnce();
    break;
  case 'watch':
    await watch();
    break;
  case 'status':
    printStatus();
    break;
  case 'reset':
    db.reset();
    log.ok('Store cleared. The next run will re-bootstrap every profile.');
    break;
  default:
    log.plain('Usage: node src/index.js [once|watch|status|reset]');
}
