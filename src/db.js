import fs from 'node:fs';
import { config, ensureDataDir } from './config.js';

// Deliberately a flat JSON file. Single process, a few thousand rows at most,
// zero native dependencies, and you can open it in a text editor when something
// looks wrong. Swap for SQLite later if the volume ever justifies it.

const EMPTY = { version: 1, profiles: {}, posts: {} };

let cache = null;

function read() {
  if (cache) return cache;
  ensureDataDir();
  if (!fs.existsSync(config.storeFile)) {
    cache = structuredClone(EMPTY);
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(config.storeFile, 'utf8'));
    cache.profiles ||= {};
    cache.posts ||= {};
  } catch {
    const backup = `${config.storeFile}.corrupt-${Date.now()}`;
    fs.copyFileSync(config.storeFile, backup);
    cache = structuredClone(EMPTY);
  }
  return cache;
}

function write() {
  ensureDataDir();
  const tmp = `${config.storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, config.storeFile); // atomic-ish, survives a mid-write crash
}

export const db = {
  isBootstrapped(profileUrl) {
    return Boolean(read().profiles[profileUrl]?.bootstrapped);
  },

  markBootstrapped(profileUrl) {
    const d = read();
    d.profiles[profileUrl] ||= { firstSeenAt: Date.now() };
    d.profiles[profileUrl].bootstrapped = true;
    write();
  },

  touchProfile(profileUrl, extra = {}) {
    const d = read();
    d.profiles[profileUrl] ||= { firstSeenAt: Date.now(), bootstrapped: false };
    Object.assign(d.profiles[profileUrl], { lastCheckedAt: Date.now() }, extra);
    write();
  },

  has(urn) {
    return Boolean(read().posts[urn]);
  },

  get(urn) {
    return read().posts[urn] || null;
  },

  /** Insert only if unseen. Returns true when this is a genuinely new post. */
  insertIfNew(urn, record) {
    const d = read();
    if (d.posts[urn]) return false;
    d.posts[urn] = { urn, detectedAt: Date.now(), attempts: 0, ...record };
    write();
    return true;
  },

  update(urn, patch) {
    const d = read();
    if (!d.posts[urn]) return;
    Object.assign(d.posts[urn], patch, { updatedAt: Date.now() });
    write();
  },

  byStatus(status) {
    return Object.values(read().posts).filter((p) => p.status === status);
  },

  /** Comments actually posted since local midnight. */
  postedToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Object.values(read().posts).filter(
      (p) => p.status === 'posted' && (p.commentedAt || 0) >= start.getTime()
    );
  },

  lastCommentedAt() {
    const times = Object.values(read().posts)
      .filter((p) => p.status === 'posted')
      .map((p) => p.commentedAt || 0);
    return times.length ? Math.max(...times) : 0;
  },

  /** Used to stop the generator repeating itself across profiles. */
  recentComments(n = 40) {
    return Object.values(read().posts)
      .filter((p) => p.comment)
      .sort((a, b) => (b.commentedAt || b.updatedAt || 0) - (a.commentedAt || a.updatedAt || 0))
      .slice(0, n)
      .map((p) => p.comment);
  },

  counts() {
    const out = {};
    for (const p of Object.values(read().posts)) {
      out[p.status] = (out[p.status] || 0) + 1;
    }
    return out;
  },

  all() {
    return Object.values(read().posts);
  },

  reset() {
    cache = structuredClone(EMPTY);
    write();
  },
};
