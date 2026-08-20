import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  return String(v).toLowerCase() === 'true' || v === '1';
};
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// DATA_DIR can point at a synced or shared folder so several machines share one
// dedupe store. SESSION_DIR always stays local — a session file is bound to the
// device and IP that created it, and moving one between machines trips
// LinkedIn's checkpoint.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const SESSION_DIR = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.join(ROOT, 'data');

// Chrome on the host OS. A Windows UA reported by a Linux machine is a
// fingerprint mismatch, so this follows the platform unless overridden.
const PLATFORM_UA = {
  win32: 'Windows NT 10.0; Win64; x64',
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
};

export const config = {
  root: ROOT,
  dataDir: DATA_DIR,
  sessionDir: SESSION_DIR,
  storeFile: path.join(DATA_DIR, 'store.json'),
  lockFile: path.join(DATA_DIR, 'store.lock'),
  sessionFile: path.join(SESSION_DIR, 'session.json'),
  profilesFile: process.env.PROFILES_FILE
    ? path.resolve(process.env.PROFILES_FILE)
    : path.join(ROOT, 'profiles.txt'),
  logFile: path.join(SESSION_DIR, 'run.log'),

  // Distinguishes which machine wrote a record when the store is shared.
  deviceName: process.env.DEVICE_NAME || os.hostname() || 'unknown-device',

  // The account's own timezone, not the server's. A VPS in Frankfurt reporting
  // Europe/Berlin for an account that has always been in Asia/Kolkata is a
  // louder signal than anything else in this file.
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  locale: process.env.LOCALE || 'en-US',
  userAgent:
    process.env.USER_AGENT ||
    `Mozilla/5.0 (${PLATFORM_UA[process.platform] || PLATFORM_UA.linux}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,

  headless: bool(process.env.HEADLESS, false),

  // How far back a post can be and still be worth commenting on.
  // Second line of defence against commenting on an old backlog.
  maxPostAgeMinutes: num(process.env.MAX_POST_AGE_MINUTES, 24 * 60),

  // Pacing
  maxCommentsPerDay: num(process.env.MAX_COMMENTS_PER_DAY, 8),
  maxCommentsPerRun: num(process.env.MAX_COMMENTS_PER_RUN, 2),
  minMinutesBetweenComments: num(process.env.MIN_MINUTES_BETWEEN_COMMENTS, 10),
  pollMinutes: num(process.env.POLL_MINUTES, 10),

  // Pause between approving a comment and it appearing, so it does not land
  // the instant the post goes up. Adjustable in the dashboard.
  commentDelayMinSeconds: num(process.env.COMMENT_DELAY_MIN_SECONDS, 10),
  commentDelayMaxSeconds: num(process.env.COMMENT_DELAY_MAX_SECONDS, 40),

  // Drafts wait for you to press "Post this". Turning this off means comments
  // go out under your name with no human ever reading them.
  requireApproval: bool(process.env.REQUIRE_APPROVAL, true),

  // Post filtering
  skipReposts: bool(process.env.SKIP_REPOSTS, true),
  minPostChars: num(process.env.MIN_POST_CHARS, 120),

  // LLM. provider: groq | gemini | ollama | template
  llm: {
    provider: (process.env.LLM_PROVIDER || 'template').toLowerCase(),
    groqKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
  },

  // Comment shape
  comment: {
    minChars: num(process.env.COMMENT_MIN_CHARS, 20),
    maxChars: num(process.env.COMMENT_MAX_CHARS, 150),
    minWords: num(process.env.COMMENT_MIN_WORDS, 5),
    maxWords: num(process.env.COMMENT_MAX_WORDS, 22),
  },
};

export function loadProfiles() {
  if (!fs.existsSync(config.profilesFile)) return [];
  return fs
    .readFileSync(config.profilesFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(normaliseProfileUrl)
    .filter(Boolean);
}

export function normaliseProfileUrl(raw) {
  const m = String(raw).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  return `https://www.linkedin.com/in/${decodeURIComponent(m[1])}`;
}

export function profileSlug(url) {
  const m = url.match(/\/in\/([^/?#]+)/);
  return m ? m[1] : url;
}

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.sessionDir, { recursive: true });
}
