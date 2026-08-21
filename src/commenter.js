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

  const typed = await editor.innerText().catch(() => '');
  if (!norm(typed)) return { posted: false, reason: 'typing_failed' };

  // Try, in order:
  //   1. selector-based submit button (scoped to the box we typed into)
  //   2. runtime DOM walk from the editor to any button that looks like Post
  //   3. keyboard shortcut Ctrl/Meta+Enter, which is LinkedIn's own submit
  //
  // Each step gets its own confirmation via editor-cleared detection.
  const attempts = [
    () => clickBySelector(page),
    () => clickByDomWalk(page),
    () => pressSubmitKey(page, editor),
  ];

  for (const attempt of attempts) {
    const label = await attempt();
    if (!label) continue;
    await sleep(rand(1800, 3000));
    if (await editorCleared(editor, comment)) {
      log.ok(`Commented on ${urn} via ${label}: "${comment}"`);
      return { posted: true };
    }
  }

  // Everything failed. Dump the composer's HTML so the next iteration has
  // real evidence to work from, then surface a specific reason.
  const evidence = await dumpComposerHtml(page).catch(() => null);
  if (evidence) log.warn(`Composer HTML snapshot: ${evidence}`);
  return { posted: false, reason: 'submit_all_paths_failed' };
}

/* ------------------------------------------------------------------ *
 * Submit strategy 1 — the selector list.
 * ------------------------------------------------------------------ */
async function clickBySelector(page) {
  const box = await firstMatch(page, SELECTORS.commentBox, { timeout: 1500 });
  const scope = box || page;
  let submit = await firstMatch(scope, SELECTORS.commentSubmit, { timeout: 4000 });
  if (!submit && scope !== page) {
    submit = await firstMatch(page, SELECTORS.commentSubmit, { timeout: 1500 });
  }
  if (!submit) return null;
  const enabled = await submit.isEnabled().catch(() => false);
  if (!enabled) {
    await sleep(rand(600, 1200));
    const ok = await submit.isEnabled().catch(() => false);
    if (!ok) return null;
  }
  const ok = await submit.click({ timeout: 6000 }).then(() => true, () => false);
  return ok ? 'selector' : null;
}

/* ------------------------------------------------------------------ *
 * Submit strategy 2 — walk the DOM from the editor. This survives class
 * rotations because it matches on aria/text, not fragile class names.
 * ------------------------------------------------------------------ */
async function clickByDomWalk(page) {
  const result = await page.evaluate(() => {
    const isSubmitCandidate = (b) => {
      if (b.disabled) return false;
      const txt = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const dc = (b.getAttribute('data-control-name') || '').toLowerCase();
      const dt = (b.getAttribute('data-testid') || '').toLowerCase();
      // "Reply", "Comment" and "Post" are all valid submit labels; block
      // things that clearly aren't (repost, reactions, share).
      if (/repost|reaction|share|emoji|attach|image|video|schedule/.test(aria)) return false;
      if (txt === 'post' || txt === 'reply' || txt === 'comment') return true;
      if (aria.startsWith('post comment') || aria === 'post' || aria.startsWith('submit')) return true;
      if (dc.includes('comment.post') || dc.includes('comments_reply_post')) return true;
      if (dt.includes('submit-comment') || dt.includes('comment-post')) return true;
      return false;
    };

    const editors = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"]'));
    // The focused one wins; else pick the first visible.
    const editor = editors.find((e) => document.activeElement === e || e.contains(document.activeElement))
      || editors.find((e) => e.offsetParent !== null)
      || editors[0];
    if (!editor) return { ok: false, why: 'no editor' };

    // Walk up looking for the composer container, then look for a submit
    // button inside it. Fall back to progressively larger scopes.
    let node = editor;
    for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
      const buttons = node.querySelectorAll('button');
      for (const b of buttons) {
        if (isSubmitCandidate(b)) {
          b.scrollIntoView({ block: 'nearest' });
          b.click();
          return { ok: true, matched: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 60) };
        }
      }
    }
    return { ok: false, why: 'no button matched' };
  });

  if (result?.ok) {
    log.info(`Submit via DOM walk matched: "${result.matched}"`);
    return 'dom-walk';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Submit strategy 3 — LinkedIn's own keyboard shortcut. Requires the
 * editor to have caret focus, which typing into it usually gives us.
 * ------------------------------------------------------------------ */
async function pressSubmitKey(page, editor) {
  await editor.focus().catch(() => {});
  // The caret can end up on a wrapper node; a stray character then Backspace
  // restores it into the contenteditable proper.
  await page.keyboard.press('End').catch(() => {});
  await sleep(rand(100, 250));
  await page.keyboard.press('Control+Enter').catch(() => {});
  await sleep(rand(300, 500));
  await page.keyboard.press('Meta+Enter').catch(() => {});
  return 'keyboard';
}

/* ------------------------------------------------------------------ *
 * Confirmation — LinkedIn clears the editor once the comment has landed.
 * The comparison normalises whitespace because a stray trailing newline
 * used to make successful posts look like failures.
 * ------------------------------------------------------------------ */
async function editorCleared(editor, comment) {
  const target = norm(comment);
  for (let i = 0; i < 3; i++) {
    const now = norm(await editor.innerText().catch(() => ''));
    if (!now || now !== target) return true;
    await sleep(700);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Debug — captures the composer HTML when all three paths fail, so the
 * next round of selector work has actual evidence to hit.
 * ------------------------------------------------------------------ */
async function dumpComposerHtml(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"]');
    if (!editor) return '(no editor found)';
    let node = editor;
    for (let i = 0; i < 6 && node.parentElement; i++) node = node.parentElement;
    return node.outerHTML.replace(/\s+/g, ' ').slice(0, 1600);
  });
}
