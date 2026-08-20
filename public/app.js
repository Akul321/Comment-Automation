const $ = (id) => document.getElementById(id);

const api = async (path, body) => {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

let lastEventAt = 0;
const editing = new Set();   // urns with unsaved edits — never clobber these
let profilesDirty = false;
let llmDirty = false;
let llmModelsCatalog = null; // filled on first render
let lastRateBanner = null;

/* ------------------------------------------------------------ theme */

const themeKey = 'comment-desk-theme';
function applyTheme(t) {
  document.body.dataset.theme = t;
  try { localStorage.setItem(themeKey, t); } catch { /* private-mode: fine */ }
}
(function initTheme() {
  let saved;
  try { saved = localStorage.getItem(themeKey); } catch { /* ignore */ }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
})();

$('theme-toggle').addEventListener('click', () => {
  applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* ------------------------------------------------------------ toast */

function toast(message, kind = 'info', ms = 3200) {
  const host = $('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.append(el);
  const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
  const timer = setTimeout(remove, ms);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

/* ------------------------------------------------- llm model dropdown */

function fillModelDropdown(provider, currentModel) {
  const sel = $('model');
  if (!llmModelsCatalog) { sel.innerHTML = ''; sel.disabled = true; return; }
  const list = llmModelsCatalog[provider] || [];
  sel.disabled = !list.length;
  if (!list.length) { sel.innerHTML = '<option>No model options</option>'; return; }
  sel.innerHTML = list.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  if (currentModel && list.some((m) => m.id === currentModel)) sel.value = currentModel;
}

function currentModelFor(provider, saved) {
  if (provider === 'groq') return saved.groqModel;
  if (provider === 'gemini') return saved.geminiModel;
  if (provider === 'ollama') return saved.ollamaModel;
  return null;
}

/* -------------------------------------------------------------- state */

function renderState(s) {
  document.body.dataset.running = String(s.running);
  llmModelsCatalog = s.settings.llmModels || llmModelsCatalog;

  const ready = s.signedIn && s.profiles.length > 0;

  let line;
  if (!s.signedIn) line = 'Sign in to begin';
  else if (!s.profiles.length) line = 'Add profiles to begin';
  else if (!s.running) line = `Stopped · ${s.profiles.length} profiles · ${s.postedToday}/${s.dailyLimit} posted today`;
  else if (s.phase === 'scanning') line = s.currentProfile ? `Checking ${s.currentProfile}` : 'Checking profiles';
  else if (s.phase === 'posting') line = 'Posting';
  else if (s.nextRunAt) {
    const m = Math.max(0, Math.round((s.nextRunAt - Date.now()) / 60000));
    line = `Next check in ${m} min · ${s.postedToday}/${s.dailyLimit} posted today`;
  } else line = 'Running';
  $('run-line').textContent = line;

  const run = $('run-toggle');
  run.disabled = !ready;
  const stopping = s.running;
  const runIcon = run.querySelector('.i use');
  const runLabel = run.querySelector('span');
  runLabel.textContent = stopping ? 'Stop' : 'Start';
  runIcon?.setAttribute('href', stopping ? '#i-stop' : '#i-play');
  run.classList.toggle('solid', !stopping);

  const scanning = s.phase === 'scanning' || s.phase === 'posting';
  $('check-now').disabled = !ready || scanning;
  $('check-now').querySelector('span').textContent = scanning ? 'Checking…' : 'Check now';

  const L = s.settings.llm;
  const llmReady =
    L.provider === 'template' ||
    L.provider === 'ollama' ||
    L.groqKeySet ||
    L.geminiKeySet;
  step('step-login', s.signedIn);
  step('step-profiles', s.profiles.length > 0);
  step('step-llm', llmReady);

  const allDone = s.signedIn && s.profiles.length > 0 && llmReady;
  $('setup-toggle').hidden = !allDone;
  if (allDone && !$('setup-toggle').dataset.touched) {
    $('setup-body').hidden = true;
    $('setup-toggle').textContent = 'Show';
  }

  // Sign-in
  const busy = s.loginStatus === 'opening' || s.loginStatus === 'waiting';
  $('login-btn').textContent = busy ? 'Waiting…' : s.signedIn ? 'Sign in again' : 'Sign in';
  $('login-btn').disabled = busy;
  const ls = $('login-state');
  const show = s.loginStatus !== 'none' || s.signedIn;
  ls.hidden = !show;
  if (show) {
    ls.dataset.state = s.signedIn && !busy ? 'saved' : s.loginStatus;
    $('login-message').textContent = s.loginMessage || (s.signedIn ? 'Signed in on this computer.' : '');
  }

  if (!profilesDirty && document.activeElement !== $('profiles')) {
    $('profiles').value = s.profiles.join('\n');
  }

  // Writer
  if (!llmDirty && document.activeElement !== $('provider')) $('provider').value = L.provider;
  if (!llmDirty) fillModelDropdown(L.provider, currentModelFor(L.provider, L));

  const provider = $('provider').value;
  const needsKey = provider === 'groq' || provider === 'gemini';
  const keyBlock = $('key-block');
  keyBlock.style.display = needsKey ? '' : 'none';

  const clearBtn = $('key-clear');
  const keySaved = provider === 'groq' ? L.groqKeySet : provider === 'gemini' ? L.geminiKeySet : false;
  clearBtn.hidden = !(needsKey && keySaved);

  if (!llmDirty) {
    $('llm-key').placeholder = keySaved
      ? 'A key is saved. Paste a new one to replace it.'
      : 'Paste your API key';
    if (needsKey) {
      $('llm-status').textContent = keySaved
        ? 'Your key is stored on this computer.'
        : 'No key stored yet. Add one — see the .env file or paste it above.';
    } else if (provider === 'ollama') {
      $('llm-status').textContent = `Using Ollama at ${L.ollamaUrl}, model ${L.ollamaModel}.`;
    } else {
      $('llm-status').textContent = 'Using built-in templates. No key needed.';
    }
  }

  // Rate line under the queue heading
  $('rate').textContent = s.blockers.length
    ? s.blockers.join(' · ')
    : `Up to ${s.dailyLimit} a day, ${s.settings.minMinutesBetweenComments} min apart · ${s.budgetLeft} left today`;

  const notice = $('notice');
  notice.hidden = !s.lastError;
  $('notice-text').textContent = s.lastError || '';

  // Rate-limit banner
  const health = s.llmHealth;
  const rateBanner = $('rate-banner');
  if (health && health.cooldownUntil && health.cooldownUntil > Date.now()) {
    const secs = Math.ceil((health.cooldownUntil - Date.now()) / 1000);
    const key = `${health.cooldownUntil}|${health.lastError}`;
    if (key !== lastRateBanner) {
      lastRateBanner = key;
      toast(`Writer rate-limited. Pausing ${secs}s — templates used in the meantime.`, 'warn', 4000);
    }
    rateBanner.hidden = false;
    $('rate-banner-text').textContent = `Writer cooling down (~${secs}s). Templates used in the meantime.`;
  } else if (rateBanner) {
    rateBanner.hidden = true;
    lastRateBanner = null;
  }

  // Limits
  fill('s-day', s.settings.maxCommentsPerDay);
  fill('s-gap', s.settings.minMinutesBetweenComments);
  fill('s-delay', s.settings.commentDelayMaxSeconds);
  if (document.activeElement !== $('s-approve')) {
    $('s-approve').checked = s.settings.requireApproval;
    $('approve-warn').hidden = s.settings.requireApproval;
  }

  appendLog(s.events);
}

const step = (id, done) => { $(id).dataset.done = String(done); };
const fill = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };

function appendLog(events) {
  if (!events.length) return;
  const list = $('log');
  for (const e of events) {
    lastEventAt = Math.max(lastEventAt, e.at);
    const li = document.createElement('li');
    li.dataset.level = e.level;
    const t = document.createElement('time');
    t.textContent = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const span = document.createElement('span');
    span.textContent = e.message;
    li.append(t, span);
    list.prepend(li);
  }
  while (list.children.length > 200) list.lastChild.remove();
}

/* -------------------------------------------------------------- queue */

function renderQueue(q) {
  $('pending-count').textContent = q.pending.length;

  const wrap = $('queue');
  const live = new Set([...q.pending, ...q.approved].map((i) => i.urn));
  [...wrap.children].forEach((c) => { if (c.dataset.urn && !live.has(c.dataset.urn)) c.remove(); });

  if (!q.pending.length && !q.approved.length) {
    if (!wrap.querySelector('.empty')) {
      wrap.innerHTML =
        '<div class="empty">Nothing waiting. New posts show up here as they are found.</div>';
    }
  } else {
    wrap.querySelector('.empty')?.remove();
  }

  for (const item of [...q.pending, ...q.approved]) {
    if (editing.has(item.urn)) continue;
    const approved = item.status === 'approved';
    const existing = wrap.querySelector(`[data-urn="${CSS.escape(item.urn)}"]`);
    const card = buildCard(item, approved);
    if (existing) existing.replaceWith(card); else wrap.append(card);
  }

  const posted = $('posted');
  posted.innerHTML = '';
  if (!q.posted.length) {
    posted.innerHTML = '<div class="empty">Nothing posted yet.</div>';
  }
  for (const item of q.posted) {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `
      <div class="slug">
        <span class="who"></span><span class="when"></span>
        <a class="out" target="_blank" rel="noopener">view on LinkedIn</a>
        <span class="flag done">posted</span>
      </div>
      <p class="draft" style="font-size:14px"></p>
      <div class="acts">
        <span class="gap"></span>
        <button class="btn act-copy" title="Copy comment"><svg class="i"><use href="#i-copy"/></svg><span>Copy</span></button>
      </div>`;
    c.querySelector('.who').textContent = item.author || item.slug || '';
    c.querySelector('.when').textContent = item.commentedAt
      ? new Date(item.commentedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    c.querySelector('.out').href = `https://www.linkedin.com/feed/update/${item.urn}/`;
    c.querySelector('.draft').textContent = item.comment || '';
    c.querySelector('.act-copy').addEventListener('click', () => copyToClipboard(item.comment || ''));
    posted.append(c);
  }
}

function buildCard(item, approved) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.urn = item.urn;

  card.innerHTML = `
    <div class="slug">
      <span class="who"></span>
      <span class="when"></span>
      <a class="out" target="_blank" rel="noopener">view on LinkedIn</a>
      ${approved ? '<span class="flag">queued</span>' : ''}
    </div>

    <div class="field">
      <span class="field-label">Their post</span>
      <div class="source"></div>
      <button class="ghost more" hidden>Show all</button>
    </div>

    <div class="field">
      <span class="field-label">Your comment, as it will appear</span>
      <div class="preview">
        <span class="avatar" aria-hidden="true"></span>
        <div class="preview-body">
          <div class="preview-name">You</div>
          <textarea class="draft" rows="2" spellcheck="true" aria-label="Your comment"></textarea>
        </div>
      </div>
    </div>

    <div class="acts">
      ${approved ? '' : '<button class="btn solid act-post"><svg class="i"><use href="#i-send"/></svg><span>Post this</span></button>'}
      <button class="btn act-save" hidden><svg class="i"><use href="#i-check"/></svg><span>Save edit</span></button>
      <button class="btn act-copy" title="Copy"><svg class="i"><use href="#i-copy"/></svg><span>Copy</span></button>
      <span class="gap"></span>
      <button class="btn strike act-discard"><svg class="i"><use href="#i-x"/></svg><span>Discard</span></button>
    </div>`;

  card.querySelector('.who').textContent = item.author || item.slug || '';
  card.querySelector('.when').textContent = item.ageRaw || '';
  card.querySelector('.out').href = `https://www.linkedin.com/feed/update/${item.urn}/`;

  const src = card.querySelector('.source');
  if (item.postText) {
    src.textContent = item.postText;
  } else {
    src.textContent = 'This post could not be read. Open it on LinkedIn before posting a comment.';
    src.classList.add('missing');
  }

  const ta = card.querySelector('.draft');
  ta.value = item.comment || '';
  requestAnimationFrame(() => {
    grow(ta);
    const more = card.querySelector('.more');
    if (src.scrollHeight > src.clientHeight + 4) {
      more.hidden = false;
      more.addEventListener('click', () => {
        more.textContent = src.classList.toggle('open') ? 'Show less' : 'Show all';
      });
    }
  });

  const save = card.querySelector('.act-save');
  ta.addEventListener('input', () => { grow(ta); editing.add(item.urn); save.hidden = false; });

  save.addEventListener('click', async () => {
    await api('/api/decide', { urn: item.urn, action: 'edit', comment: ta.value.trim() });
    editing.delete(item.urn);
    save.hidden = true;
    toast('Saved.');
  });

  card.querySelector('.act-copy').addEventListener('click', () => copyToClipboard(ta.value));

  card.querySelector('.act-post')?.addEventListener('click', async () => {
    editing.delete(item.urn);
    card.style.opacity = '.5';
    await api('/api/decide', { urn: item.urn, action: 'approve', comment: ta.value.trim() });
    toast('Queued for posting.');
    refreshQueue();
  });

  card.querySelector('.act-discard').addEventListener('click', async () => {
    editing.delete(item.urn);
    card.style.opacity = '.3';
    await api('/api/decide', { urn: item.urn, action: 'reject' });
    toast('Discarded.', 'warn');
    refreshQueue();
  });

  return card;
}

function grow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  } catch {
    toast('Copy failed — select and copy manually.', 'error');
  }
}

function renderSkipped(items) {
  const box = $('skipped');
  if (!items.length) {
    box.innerHTML = '<div class="empty">Nothing has been skipped yet.</div>';
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'skips';
  for (const i of items) {
    const li = document.createElement('li');
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = i.skipReason || 'no reason recorded';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = i.slug || '';
    li.append(why, who);
    ul.append(li);
  }
  box.innerHTML = '';
  box.append(ul);
}

/* ------------------------------------------------------------ actions */

$('run-toggle').addEventListener('click', async () => {
  const stopping = $('run-toggle').querySelector('span').textContent === 'Stop';
  await api(stopping ? '/api/stop' : '/api/start', {});
  refresh();
});

$('check-now').addEventListener('click', async () => {
  $('check-now').disabled = true;
  await api('/api/scan-now', {});
  refresh();
});

$('login-btn').addEventListener('click', async () => {
  $('login-btn').disabled = true;
  await api('/api/login', {});
  refresh();
});

$('profiles').addEventListener('input', () => { profilesDirty = true; });

$('save-profiles').addEventListener('click', async () => {
  const r = await api('/api/profiles', { raw: $('profiles').value });
  profilesDirty = false;
  const msg = r.rejected.length
    ? `${r.saved.length} saved · ${r.rejected.length} not recognised: ${r.rejected.slice(0, 3).join(', ')}`
    : `${r.saved.length} profile${r.saved.length === 1 ? '' : 's'} saved`;
  $('profiles-status').textContent = msg;
  toast(msg);
  refresh();
});

$('provider').addEventListener('change', () => {
  llmDirty = true;
  const provider = $('provider').value;
  const keyBlock = $('key-block');
  const needsKey = provider === 'groq' || provider === 'gemini';
  keyBlock.style.display = needsKey ? '' : 'none';
  fillModelDropdown(provider);
  $('llm-status').textContent = needsKey
    ? `Paste your ${provider === 'groq' ? 'Groq' : 'Gemini'} key and press Save.`
    : provider === 'ollama'
      ? 'Local model. Make sure Ollama is running on your machine.'
      : 'No key needed. Press Save to switch.';
  $('llm-sample').hidden = true;
});

$('model').addEventListener('change', () => { llmDirty = true; });
$('llm-key').addEventListener('input', () => { llmDirty = true; });

$('key-reveal').addEventListener('click', () => {
  const el = $('llm-key');
  const revealed = el.dataset.revealed === 'true';
  el.type = revealed ? 'password' : 'text';
  el.dataset.revealed = String(!revealed);
});

$('key-clear').addEventListener('click', async () => {
  const provider = $('provider').value;
  if (!confirm(`Remove the saved ${provider} key?`)) return;
  await api('/api/settings', { llm: { provider, keyFor: provider, apiKey: '' } });
  llmDirty = false;
  $('llm-key').value = '';
  toast('Key cleared.');
  refresh();
});

$('save-llm').addEventListener('click', async () => {
  const provider = $('provider').value;
  const model = $('model').value;
  const key = $('llm-key').value.trim();
  const patch = { llm: { provider } };
  if (provider === 'groq') patch.llm.groqModel = model;
  if (provider === 'gemini') patch.llm.geminiModel = model;
  if (provider === 'ollama') patch.llm.ollamaModel = model;
  if (key || (provider === 'groq' || provider === 'gemini')) {
    patch.llm.keyFor = provider;
    patch.llm.apiKey = key;
  }
  await api('/api/settings', patch);
  $('llm-key').value = '';
  llmDirty = false;
  toast('Writer saved.');
  refresh();
});

$('test-llm').addEventListener('click', async () => {
  const btn = $('test-llm');
  const label = btn.querySelector('span');
  const before = label.textContent;
  btn.disabled = true;
  label.textContent = 'Testing…';
  const sample = $('llm-sample');
  sample.hidden = true;
  sample.classList.remove('error');

  const provider = $('provider').value;
  const model = $('model').value;
  const key = $('llm-key').value.trim();
  const patch = { llm: { provider } };
  if (provider === 'groq') patch.llm.groqModel = model;
  if (provider === 'gemini') patch.llm.geminiModel = model;
  if (provider === 'ollama') patch.llm.ollamaModel = model;
  if (key) { patch.llm.keyFor = provider; patch.llm.apiKey = key; }

  try {
    const res = await api('/api/test-llm', patch);
    if (res.ok) {
      sample.hidden = false;
      sample.textContent = `Sample: ${res.sample}`;
      toast('Writer is working.', 'info');
      llmDirty = false;
      $('llm-key').value = '';
    } else {
      sample.hidden = false;
      sample.classList.add('error');
      const wait = res.retryAfterMs ? ` (retry in ~${Math.ceil(res.retryAfterMs / 1000)}s)` : '';
      sample.textContent = `Failed: ${res.reason || 'unknown error'}${wait}`;
      toast('Writer test failed.', 'error');
    }
  } catch (err) {
    sample.hidden = false;
    sample.classList.add('error');
    sample.textContent = `Failed: ${err.message}`;
    toast('Writer test failed.', 'error');
  } finally {
    btn.disabled = false;
    label.textContent = before;
    refresh();
  }
});

$('s-approve').addEventListener('change', (e) => { $('approve-warn').hidden = e.target.checked; });

$('save-settings').addEventListener('click', async () => {
  const delay = Number($('s-delay').value);
  await api('/api/settings', {
    maxCommentsPerDay: Number($('s-day').value),
    minMinutesBetweenComments: Number($('s-gap').value),
    commentDelayMaxSeconds: delay,
    commentDelayMinSeconds: Math.max(0, Math.round(delay / 3)),
    requireApproval: $('s-approve').checked,
  });
  toast('Limits saved.');
  refresh();
});

$('settings-toggle').addEventListener('click', () => {
  const el = $('settings');
  el.hidden = !el.hidden;
  $('settings-toggle').textContent = el.hidden ? 'Limits' : 'Hide limits';
});

$('skipped-toggle').addEventListener('click', async () => {
  const box = $('skipped');
  box.hidden = !box.hidden;
  $('skipped-toggle').textContent = box.hidden ? 'Skipped' : 'Hide skipped';
  if (!box.hidden) renderSkipped(await api('/api/skipped'));
});

$('setup-toggle').addEventListener('click', () => {
  const b = $('setup-body');
  b.hidden = !b.hidden;
  $('setup-toggle').dataset.touched = '1';
  $('setup-toggle').textContent = b.hidden ? 'Show' : 'Hide';
});

/* --------------------------------------------------------- shortcuts */

const dlg = $('shortcuts-dialog');
$('shortcuts-toggle').addEventListener('click', () => dlg?.showModal?.());

window.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); dlg?.showModal?.(); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); $('run-toggle').click(); }
  else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); $('check-now').click(); }
  else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); $('theme-toggle').click(); }
});

/* --------------------------------------------------------------- loop */

async function refresh() {
  try {
    renderState(await api(`/api/state?since=${lastEventAt}`));
  } catch {
    $('notice').hidden = false;
    $('notice-text').textContent = 'Lost contact with the app. Check it is still running in your terminal.';
  }
}

async function refreshQueue() {
  try { renderQueue(await api('/api/queue')); } catch { /* transient */ }
}

refresh();
refreshQueue();
setInterval(refresh, 3000);
setInterval(refreshQueue, 6000);
