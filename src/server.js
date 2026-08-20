import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadSettings, saveSettings, publicSettings, readProfiles, writeProfiles } from './settings.js';
import { db } from './db.js';
import { hasSession } from './session.js';
import { llmHealth, testLLM } from './generator.js';
import {
  state,
  startWorker,
  stopWorker,
  scanNow,
  startLogin,
  getEvents,
  blockers,
  dailyBudgetLeft,
} from './worker.js';

loadSettings();

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 4141;
// Loopback only by default. Set HOST=0.0.0.0 to reach the dashboard from a
// phone on the same network — only do that on a network you trust.
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Never serve outside the public directory.
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
    return send(res, 404, 'Not found', 'text/plain');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

function snapshot(since = 0) {
  const counts = db.counts();
  return {
    device: config.deviceName,
    signedIn: hasSession(),
    loginStatus: state.loginStatus,
    loginMessage: state.loginMessage,
    running: state.running,
    phase: state.phase,
    currentProfile: state.currentProfile,
    nextRunAt: state.nextRunAt,
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    requireApproval: config.requireApproval,
    profiles: readProfiles(),
    settings: publicSettings(),
    counts,
    postedToday: db.postedToday().length,
    dailyLimit: config.maxCommentsPerDay,
    budgetLeft: dailyBudgetLeft(),
    blockers: blockers(),
    llmHealth: llmHealth(),
    events: getEvents(since),
  };
}

function queueItems() {
  const shape = (p) => ({
    urn: p.urn,
    slug: p.slug,
    author: p.author,
    postText: (p.text || '').slice(0, 600),
    ageRaw: p.ageRaw,
    comment: p.comment,
    status: p.status,
    detectedAt: p.detectedAt,
    commentedAt: p.commentedAt,
    lastError: p.lastError,
  });
  return {
    pending: db.byStatus('pending').sort((a, b) => b.detectedAt - a.detectedAt).map(shape),
    approved: db.byStatus('approved').sort((a, b) => b.detectedAt - a.detectedAt).map(shape),
    posted: db
      .byStatus('posted')
      .sort((a, b) => (b.commentedAt || 0) - (a.commentedAt || 0))
      .slice(0, 25)
      .map(shape),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (!p.startsWith('/api/')) return serveStatic(res, p);

  try {
    if (req.method === 'GET' && p === '/api/state') {
      return send(res, 200, snapshot(Number(url.searchParams.get('since')) || 0));
    }
    if (req.method === 'GET' && p === '/api/skipped') {
      return send(
        res,
        200,
        db
          .byStatus('skipped')
          .sort((a, b) => b.detectedAt - a.detectedAt)
          .slice(0, 40)
          .map((x) => ({ urn: x.urn, slug: x.slug, skipReason: x.skipReason, detectedAt: x.detectedAt }))
      );
    }
    if (req.method === 'GET' && p === '/api/queue') {
      return send(res, 200, queueItems());
    }
    if (req.method === 'POST' && p === '/api/login') {
      return send(res, 200, await startLogin());
    }
    if (req.method === 'POST' && p === '/api/profiles') {
      const { raw } = await readBody(req);
      return send(res, 200, writeProfiles(raw));
    }
    if (req.method === 'POST' && p === '/api/settings') {
      return send(res, 200, saveSettings(await readBody(req)));
    }
    if (req.method === 'POST' && p === '/api/test-llm') {
      // Optional patch: apply any pending provider/model/key change *before*
      // testing, so the button reflects what the user just typed rather than
      // the last saved state.
      const patch = await readBody(req);
      if (patch && (patch.llm || patch.provider || patch.apiKey)) {
        saveSettings(patch.llm ? patch : { llm: patch });
      }
      return send(res, 200, await testLLM());
    }
    if (req.method === 'POST' && p === '/api/start') {
      return send(res, 200, { started: startWorker() });
    }
    if (req.method === 'POST' && p === '/api/stop') {
      return send(res, 200, { stopped: stopWorker() });
    }
    if (req.method === 'POST' && p === '/api/scan-now') {
      scanNow();
      return send(res, 200, { started: true });
    }
    if (req.method === 'POST' && p === '/api/decide') {
      const { urn, action, comment } = await readBody(req);
      if (!db.get(urn)) return send(res, 404, { error: 'Unknown post' });
      if (action === 'approve') {
        db.update(urn, { status: 'approved', ...(comment ? { comment } : {}) });
      } else if (action === 'reject') {
        db.update(urn, { status: 'rejected', skipReason: 'rejected_by_user' });
      } else if (action === 'edit') {
        db.update(urn, { comment });
      } else {
        return send(res, 400, { error: 'Unknown action' });
      }
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log(`  Comment desk running at  http://${shown}:${PORT}`);
  if (HOST === '0.0.0.0') console.log('  Also reachable from other devices on this network.');
  console.log(`  Device: ${config.deviceName}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
