import fs from 'node:fs';
import { chromium } from 'playwright';
import { config } from './config.js';
import { SELECTORS, anyPresent } from './selectors.js';
import { log } from './logger.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
export const jitter = (ms, pct = 0.3) => rand(ms * (1 - pct), ms * (1 + pct));

export function hasSession() {
  return fs.existsSync(config.sessionFile);
}

export async function launch({ forLogin = false } = {}) {
  const browser = await chromium.launch({
    headless: forLogin ? false : config.headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: { width: 1366, height: 900 },
    locale: config.locale,
    timezoneId: config.timezone,
    storageState: !forLogin && hasSession() ? config.sessionFile : undefined,
  });

  // navigator.webdriver is the cheapest automation tell there is.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  context.setDefaultTimeout(20000);
  return { browser, context };
}

export async function saveSession(context) {
  await context.storageState({ path: config.sessionFile });
  log.info(`Session saved to ${config.sessionFile}`);
}

/**
 * LinkedIn sets `li_at` once an account is fully authenticated. It is the
 * actual session token, so checking for it is far more reliable than matching
 * CSS class names on the nav bar — those get renamed regularly and silently
 * break sign-in detection.
 */
export async function isAuthenticated(page) {
  try {
    const cookies = await page.context().cookies('https://www.linkedin.com');
    const liAt = cookies.find((c) => c.name === 'li_at' && c.value && c.value.length > 20);
    if (!liAt) return false;
  } catch {
    return false;
  }
  // The cookie can exist while a checkpoint is still outstanding.
  return !/\/(login|uas\/login|checkpoint|authwall)/.test(page.url());
}

/** Plain-language description of where the sign-in has got to, for the UI. */
export async function loginStage(page) {
  let url = '';
  try {
    url = page.url();
  } catch {
    return { stage: 'closed', message: 'The sign-in window was closed.' };
  }

  let hasToken = false;
  try {
    const cookies = await page.context().cookies('https://www.linkedin.com');
    hasToken = cookies.some((c) => c.name === 'li_at' && c.value && c.value.length > 20);
  } catch {
    /* mid-navigation */
  }

  if (/\/checkpoint/.test(url)) {
    return { stage: 'checkpoint', message: 'LinkedIn is asking for a security check — complete it in the browser window.' };
  }
  if (/\/(login|uas\/login)/.test(url)) {
    return { stage: 'credentials', message: 'Enter your email and password in the browser window.' };
  }
  if (hasToken) {
    return { stage: 'done', message: 'Signed in.' };
  }
  return { stage: 'loading', message: 'Loading LinkedIn…' };
}

export async function dismissOverlays(page) {
  for (const sel of SELECTORS.dismissable) {
    try {
      const loc = page.locator(sel);
      const n = await loc.count();
      for (let i = 0; i < Math.min(n, 3); i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 1500 }).catch(() => {});
          await sleep(200);
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/** Type character by character with irregular gaps. */
export async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(rand(35, 115));
    if (ch === ' ' && Math.random() < 0.12) await sleep(rand(120, 320));
  }
}

/** Scroll in steps rather than jumping, so lazy-loaded posts actually render. */
export async function humanScroll(page, steps = 3) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, rand(600, 1100));
    await sleep(rand(700, 1600));
  }
}
