import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir, normaliseProfileUrl } from './config.js';

// The .env file provides defaults. Anything changed in the dashboard is written
// here and wins on next load, so a non-technical user never has to open a file.

const SETTINGS_FILE = path.join(config.dataDir, 'settings.json');

const EDITABLE = [
  'maxCommentsPerDay',
  'maxCommentsPerRun',
  'minMinutesBetweenComments',
  'commentDelayMinSeconds',
  'commentDelayMaxSeconds',
  'maxPostAgeMinutes',
  'minPostChars',
  'skipReposts',
  'requireApproval',
];

const EDITABLE_LLM = ['provider', 'groqKey', 'groqModel', 'geminiKey', 'geminiModel', 'ollamaUrl', 'ollamaModel'];

// Which per-provider setting a `apiKey` from the dashboard maps to.
const KEY_FIELD = { groq: 'groqKey', gemini: 'geminiKey' };
const MODEL_FIELD = { groq: 'groqModel', gemini: 'geminiModel', ollama: 'ollamaModel' };

export function loadSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    for (const k of EDITABLE) {
      if (saved[k] !== undefined) config[k] = saved[k];
    }
    if (saved.llm) {
      for (const k of EDITABLE_LLM) {
        if (saved.llm[k] !== undefined) config.llm[k] = saved.llm[k];
      }
    }
  } catch {
    /* a corrupt settings file should not stop the app booting */
  }
}

export function saveSettings(patch) {
  ensureDataDir();
  for (const k of EDITABLE) {
    if (patch[k] !== undefined) config[k] = patch[k];
  }
  if (patch.llm) {
    if (patch.llm.provider !== undefined) config.llm.provider = patch.llm.provider;
    for (const provider of Object.keys(MODEL_FIELD)) {
      const field = MODEL_FIELD[provider];
      if (patch.llm[field] !== undefined) config.llm[field] = patch.llm[field];
    }
    if (patch.llm.ollamaUrl !== undefined) config.llm.ollamaUrl = patch.llm.ollamaUrl;

    // The dashboard sends one `apiKey` field; the server files it under
    // whichever provider is selected. Doing this client-side meant a stale
    // dropdown value could silently discard the key. An empty string clears
    // whatever was saved.
    if (patch.llm.apiKey !== undefined) {
      const target = patch.llm.keyFor || patch.llm.provider || config.llm.provider;
      const field = KEY_FIELD[target];
      if (field) config.llm[field] = String(patch.llm.apiKey).trim();
    }
  }

  const out = {};
  for (const k of EDITABLE) out[k] = config[k];
  out.llm = {};
  for (const k of EDITABLE_LLM) out.llm[k] = config.llm[k];

  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  return publicSettings();
}

/** Never send API keys back to the browser in full. */
export function publicSettings() {
  const out = {};
  for (const k of EDITABLE) out[k] = config[k];
  out.llm = {
    provider: config.llm.provider,
    groqModel: config.llm.groqModel,
    geminiModel: config.llm.geminiModel,
    ollamaUrl: config.llm.ollamaUrl,
    ollamaModel: config.llm.ollamaModel,
    groqKeySet: Boolean(config.llm.groqKey),
    geminiKeySet: Boolean(config.llm.geminiKey),
  };
  out.llmModels = config.llmModels;
  return out;
}

export function readProfiles() {
  if (!fs.existsSync(config.profilesFile)) return [];
  return fs
    .readFileSync(config.profilesFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Accepts pasted text in any shape — newlines, commas, extra whitespace,
 * tracking parameters — and returns a clean deduplicated list.
 */
export function writeProfiles(raw) {
  const lines = String(raw || '')
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const good = [];
  const bad = [];
  const seen = new Set();

  for (const line of lines) {
    const url = normaliseProfileUrl(line);
    if (!url) {
      bad.push(line);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    good.push(url);
  }

  fs.writeFileSync(
    config.profilesFile,
    `# One LinkedIn profile URL per line.\n${good.join('\n')}\n`
  );
  return { saved: good, rejected: bad };
}
