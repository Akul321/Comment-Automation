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

/* -------------------------------------------------------------- state */

function renderState(s) {
  document.body.dataset.running = String(s.running);

  const ready = s.signedIn && s.profiles.length > 0;

  // One line that says what the desk is doing right now.
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
  run.textContent = s.running ? 'Stop' : 'Start';
  run.classList.toggle('solid', !s.running);

  const scanning = s.phase === 'scanning' || s.phase === 'posting';
  $('check-now').disabled = !ready || scanning;
  $('check-now').textContent = scanning ? 'Checking…' : 'Check now';

  // Setup steps
  const llmReady =
    s.settings.llm.provider === 'template' ||
    s.settings.llm.provider === 'ollama' ||
    s.settings.llm.groqKeySet ||
    s.settings.llm.geminiKeySet;
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
  const L = s.settings.llm;
  if (!llmDirty && document.activeElement !== $('provider')) $('provider').value = L.provider;
  const needsKey = $('provider').value === 'groq' || $('provider').value === 'gemini';
  $('llm-key').disabled = !needsKey;
  $('llm-key').placeholder = needsKey ? 'Paste your API key' : 'No key needed';
  if (!llmDirty) {
    const keyed = { groq: L.groqKeySet, gemini: L.geminiKeySet };
    $('llm-status').textContent = needsKey
      ? keyed[$('provider').value]
        ? 'A key is saved for this option. Paste a new one to replace it.'
        : 'No key saved yet. Comments cannot be written until you add one.'
      : $('provider').value === 'ollama'
        ? `Using Ollama at ${L.ollamaUrl}, model ${L.ollamaModel}.`
        : 'Using built-in templates. No key needed.';
  }

  // Rate line under the queue heading
  $('rate').textContent = s.blockers.length
    ? s.blockers.join(' · ')
    : `Up to ${s.dailyLimit} a day, ${s.settings.minMinutesBetweenComments} min apart · ${s.budgetLeft} left today`;

  const notice = $('notice');
  notice.hidden = !s.lastError;
  notice.textContent = s.lastError || '';

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
      <p class="draft" style="font-size:14px"></p>`;
    c.querySelector('.who').textContent = item.author || item.slug || '';
    c.querySelector('.when').textContent = item.commentedAt
      ? new Date(item.commentedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    c.querySelector('.out').href = `https://www.linkedin.com/feed/update/${item.urn}/`;
    c.querySelector('.draft').textContent = item.comment || '';
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
      ${approved ? '' : '<button class="btn solid act-post">Post this</button>'}
      <button class="btn act-save" hidden>Save edit</button>
      <span class="gap"></span>
      <button class="btn strike act-discard">Discard</button>
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
  });

  card.querySelector('.act-post')?.addEventListener('click', async () => {
    editing.delete(item.urn);
    card.remove();
    await api('/api/decide', { urn: item.urn, action: 'approve', comment: ta.value.trim() });
    refreshQueue();
  });

  card.querySelector('.act-discard').addEventListener('click', async () => {
    editing.delete(item.urn);
    card.remove();
    await api('/api/decide', { urn: item.urn, action: 'reject' });
    refreshQueue();
  });

  return card;
}

function grow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }

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
  const stopping = $('run-toggle').textContent === 'Stop';
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
  $('profiles-status').textContent = r.rejected.length
    ? `${r.saved.length} saved · ${r.rejected.length} not recognised: ${r.rejected.slice(0, 3).join(', ')}`
    : `${r.saved.length} profile${r.saved.length === 1 ? '' : 's'} saved`;
  refresh();
});

$('provider').addEventListener('change', () => {
  llmDirty = true;
  const needsKey = $('provider').value === 'groq' || $('provider').value === 'gemini';
  $('llm-key').disabled = !needsKey;
  $('llm-key').placeholder = needsKey ? 'Paste your API key' : 'No key needed';
  $('llm-status').textContent = needsKey ? 'Paste a key and press Save.' : 'No key needed. Press Save to switch.';
});
$('llm-key').addEventListener('input', () => { llmDirty = true; });

$('save-llm').addEventListener('click', async () => {
  const provider = $('provider').value;
  const key = $('llm-key').value.trim();
  const needsKey = provider === 'groq' || provider === 'gemini';

  // The server files the key under whichever option is selected, so a stale
  // dropdown can no longer cause it to be dropped silently.
  const saved = await api('/api/settings', { llm: { provider, ...(key ? { apiKey: key } : {}) } });

  $('llm-key').value = '';
  llmDirty = false;
  const keyed = { groq: saved.llm.groqKeySet, gemini: saved.llm.geminiKeySet };
  $('llm-status').textContent = !needsKey
    ? 'Saved.'
    : keyed[provider]
      ? 'Saved. The key is stored on this computer.'
      : 'Saved, but no key is stored yet. Paste one and press Save again.';
  refresh();
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

/* --------------------------------------------------------------- loop */

async function refresh() {
  try {
    renderState(await api(`/api/state?since=${lastEventAt}`));
  } catch {
    $('notice').hidden = false;
    $('notice').textContent = 'Lost contact with the app. Check it is still running in your terminal.';
  }
}

async function refreshQueue() {
  try { renderQueue(await api('/api/queue')); } catch { /* transient */ }
}

refresh();
refreshQueue();
setInterval(refresh, 3000);
setInterval(refreshQueue, 6000);
