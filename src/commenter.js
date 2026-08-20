import { config } from './config.js';
import { SELECTORS, firstMatch } from './selectors.js';
import { postUrl } from './scraper.js';
import { sleep, rand, humanType, dismissOverlays, isAuthenticated } from './session.js';
import { log } from './logger.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

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

  // Compare normalised whitespace — a contenteditable div often reports back
  // with a trailing newline that doesn't mean typing failed.
  const typed = await editor.innerText().catch(() => '');
  if (!norm(typed)) return { posted: false, reason: 'typing_failed' };
  if (norm(typed) !== norm(comment)) {
    log.warn(`Editor content mismatch. Expected "${comment}", found "${typed}"`);
    // Not fatal — LinkedIn sometimes adds invisible spans; the submit path
    // still works as long as something was typed.
  }

  // Prefer scoping the submit search to the specific comment box we just typed
  // into. That stops us picking up a stray "Post" button somewhere else on
  // the page (e.g. the composer at the top of the feed).
  const box = await firstMatch(page, SELECTORS.commentBox, { timeout: 2000 });
  const scope = box || page;

  let submit = await firstMatch(scope, SELECTORS.commentSubmit, { timeout: 6000 });
  // Second attempt against the whole page in case scoping was too tight.
  if (!submit && scope !== page) {
    submit = await firstMatch(page, SELECTORS.commentSubmit, { timeout: 2000 });
  }

  if (submit) {
    const enabled = await submit.isEnabled().catch(() => false);
    if (!enabled) {
      // Give LinkedIn a moment to enable the button after we finished typing.
      await sleep(rand(600, 1200));
    }
    const okNow = await submit.isEnabled().catch(() => false);
    if (okNow) {
      await submit.click({ timeout: 8000 }).catch(() => {});
    } else {
      log.warn('Submit button found but not enabled — trying Ctrl+Enter fallback');
      await pressCtrlEnter(page, editor);
    }
  } else {
    log.warn('submit_button_not_found — trying Ctrl+Enter fallback');
    await pressCtrlEnter(page, editor);
  }

  await sleep(rand(2500, 4500));

  // A cleared editor is LinkedIn's own confirmation that the comment landed.
  const after = norm(await editor.innerText().catch(() => ''));
  if (after && after === norm(comment)) {
    // One more chance — LinkedIn sometimes leaves the last typed text in the
    // DOM briefly before clearing.
    await sleep(rand(1200, 2200));
    const after2 = norm(await editor.innerText().catch(() => ''));
    if (after2 && after2 === norm(comment)) {
      return { posted: false, reason: submit ? 'editor_did_not_clear' : 'submit_button_not_found' };
    }
  }

  log.ok(`Commented on ${urn}: "${comment}"`);
  return { posted: true };
}

/**
 * LinkedIn's own keyboard shortcut for submitting a comment. Works
 * regardless of what class name the Post button happens to have this week.
 */
async function pressCtrlEnter(page, editor) {
  await editor.focus().catch(() => {});
  await sleep(rand(150, 350));
  // Try both — macOS uses Meta, others use Control. Playwright routes to the
  // right platform key when we use the modifier alias.
  await page.keyboard.press('Control+Enter').catch(() => {});
  await sleep(rand(200, 400));
  await page.keyboard.press('Meta+Enter').catch(() => {});
}
