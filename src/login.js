import { launch, saveSession, isAuthenticated, sleep } from './session.js';
import { log } from './logger.js';

/**
 * You log in yourself in the browser window this opens. The script never sees,
 * stores or types your password — it only waits until LinkedIn shows a
 * logged-in shell and then saves the resulting cookies.
 */
const TIMEOUT_MINUTES = 6;

const { browser, context } = await launch({ forLogin: true });
const page = await context.newPage();

await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

log.plain('');
log.plain('  A browser window has opened.');
log.plain('  Log in to LinkedIn there yourself, including any 2FA or checkpoint.');
log.plain('  This script is only waiting — it will not touch the form.');
log.plain('');

const deadline = Date.now() + TIMEOUT_MINUTES * 60 * 1000;
let done = false;

while (Date.now() < deadline) {
  await sleep(2500);
  try {
    if (await isAuthenticated(page)) {
      done = true;
      break;
    }
  } catch {
    /* page may be mid-navigation */
  }
}

if (done) {
  await sleep(1500);
  await saveSession(context);
  log.ok('Logged in. You can close the browser.');
} else {
  log.error(`No login detected within ${TIMEOUT_MINUTES} minutes. Nothing saved.`);
}

await browser.close();
process.exit(done ? 0 : 1);
