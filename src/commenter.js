import { config } from './config.js';
import { SELECTORS, firstMatch } from './selectors.js';
import { postUrl } from './scraper.js';
import { sleep, rand, humanType, dismissOverlays, isAuthenticated } from './session.js';
import { log } from './logger.js';

/**
 * Open a post and leave one comment.
 * Returns {posted: boolean, reason?: string}
 */
export async function postComment(page, urn, comment) {
  const url = postUrl(urn);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(rand(2000, 4000));

  if (!(await isAuthenticated(page))) throw new Error('SESSION_INVALID');
  await dismissOverlays(page);

  // Read the post like a person would before replying.
  await page.mouse.wheel(0, rand(300, 700));
  await sleep(rand(1500, 3500));

  let editor = await firstMatch(page, SELECTORS.commentEditor, { timeout: 3000 });

  if (!editor) {
    const btn = await firstMatch(page, SELECTORS.commentButton, { timeout: 8000 });
    if (!btn) return { posted: false, reason: 'comment_button_not_found' };
    await btn.click({ timeout: 8000 }).catch(() => {});
    await sleep(rand(1200, 2400));
    editor = await firstMatch(page, SELECTORS.commentEditor, { timeout: 10000 });
  }

  if (!editor) return { posted: false, reason: 'comment_editor_not_found' };

  await editor.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(rand(400, 900));
  await editor.click({ timeout: 8000 });
  await sleep(rand(500, 1100));

  await humanType(page, comment);
  await sleep(rand(900, 2000));

  const typed = (await editor.innerText().catch(() => '')).trim();
  if (!typed || typed.replace(/\s+/g, ' ') !== comment.replace(/\s+/g, ' ')) {
    log.warn(`Editor content mismatch. Expected "${comment}", found "${typed}"`);
    if (!typed) return { posted: false, reason: 'typing_failed' };
  }

  const submit = await firstMatch(page, SELECTORS.commentSubmit, { timeout: 6000 });
  if (!submit) return { posted: false, reason: 'submit_button_not_found' };

  const enabled = await submit.isEnabled().catch(() => false);
  if (!enabled) return { posted: false, reason: 'submit_disabled' };

  await submit.click({ timeout: 8000 });
  await sleep(rand(2500, 4500));

  // A cleared editor is LinkedIn's own confirmation that the comment landed.
  const after = (await editor.innerText().catch(() => '')).trim();
  if (after && after.replace(/\s+/g, ' ') === comment.replace(/\s+/g, ' ')) {
    return { posted: false, reason: 'editor_did_not_clear' };
  }

  log.ok(`Commented on ${urn}: "${comment}"`);
  return { posted: true };
}
