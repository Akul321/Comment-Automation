// Every LinkedIn selector lives here. When LinkedIn ships a layout change,
// this is the only file you should need to touch.
//
// Each entry is an ordered list of candidates: the code tries them in turn and
// uses the first that resolves. Prefer role/aria/data attributes over class
// names, because LinkedIn's class names are obfuscated and rotate often.

export const SELECTORS = {
  // Marks that we are logged in and on a real page rather than an auth wall.
  loggedIn: ['header.global-nav__nav', 'nav.global-nav', '#global-nav'],

  authWall: [
    'form.login__form',
    'input#username',
    'a[href*="/authwall"]',
    '.authwall-join-form',
  ],

  // Containers on the recent-activity feed that represent one post.
  postContainer: [
    'div.feed-shared-update-v2',
    'div[data-urn*="urn:li:activity"]',
    'div[data-id*="urn:li:activity"]',
    'div.occludable-update',
  ],

  // The post body text inside a container.
  postText: [
    '.update-components-text',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-update-v2__description',
    '.update-components-update-v2__commentary',
  ],

  // "2h", "1d", "3w" and the "reposted this" marker both live in the actor block.
  actorSubDescription: [
    '.update-components-actor__sub-description',
    '.update-components-actor__description',
  ],

  actorName: ['.update-components-actor__title', '.update-components-actor__name'],

  // On the single-post page, the button that opens the comment editor.
  commentButton: [
    'button[aria-label^="Comment"]',
    'button[aria-label*="omment"]',
    '.comment-button',
    'button.social-actions-button:has-text("Comment")',
  ],

  // LinkedIn uses a Quill editor for comments.
  commentEditor: [
    'div.ql-editor[contenteditable="true"]',
    'div.comments-comment-box__form div[role="textbox"]',
    '.comments-comment-box div[role="textbox"][contenteditable="true"]',
    'div[data-placeholder*="dd a comment" i][contenteditable="true"]',
    'div[data-placeholder*="comment" i][contenteditable="true"]',
    'div[aria-label*="dd a comment" i][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ],

  // The whole comment box container — we scope the submit-button search to
  // this so a "Post" button somewhere else on the page can never win.
  commentBox: [
    'form.comments-comment-box__form',
    '.comments-comment-box',
    '.comments-comment-texteditor',
    'div[data-view-name*="comment-composer" i]',
  ],

  // Submit control inside the comment box. Wide list because LinkedIn rotates
  // class names; role/aria/text/data-* selectors survive those rotations.
  commentSubmit: [
    'button.comments-comment-box__submit-button--cr',
    'button.comments-comment-box__submit-button',
    'button.comments-comment-box-comment__submit-button--cr',
    'button.comments-comment-box-comment__submit-button',
    'button[data-control-name="comment.post" i]',
    'button[data-testid*="comment-post" i]',
    'button[data-testid*="submit-comment" i]',
    'button[aria-label="Post comment" i]',
    'button[aria-label^="Post" i]',
    'button[aria-label*="submit comment" i]',
    'button:has(span:text-is("Post"))',
    'button:has-text("Post"):not([aria-label*="repost" i]):not([aria-label*="reaction" i])',
    'button[type="submit"]',
  ],

  // Dismissable overlays that steal clicks.
  dismissable: [
    'button[aria-label="Dismiss"]',
    'button[aria-label="Close"]',
    '.msg-overlay-bubble-header__control[aria-label*="Close"]',
    'button.artdeco-modal__dismiss',
  ],
};

/** Return the first selector in the list that matches at least one element. */
export async function firstMatch(scope, candidates, { timeout = 8000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of candidates) {
      try {
        const loc = scope.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          return loc;
        }
      } catch {
        // A malformed or unsupported selector should never kill the run.
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Non-blocking variant: no waiting, just tells you whether anything matches. */
export async function anyPresent(scope, candidates) {
  for (const sel of candidates) {
    try {
      if ((await scope.locator(sel).count()) > 0) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
