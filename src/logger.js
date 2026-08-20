import fs from 'node:fs';
import { config, ensureDataDir } from './config.js';

const COLORS = {
  info: '\x1b[36m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  dim: '\x1b[90m',
  reset: '\x1b[0m',
};

function emit(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colour = COLORS[level] || '';
  console.log(`${COLORS.dim}${ts}${COLORS.reset} ${colour}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${msg}`);
  try {
    ensureDataDir();
    fs.appendFileSync(config.logFile, `${ts} ${level.toUpperCase()} ${msg}\n`);
  } catch {
    /* logging must never take the process down */
  }
}

export const log = {
  info: (m) => emit('info', m),
  ok: (m) => emit('ok', m),
  warn: (m) => emit('warn', m),
  error: (m) => emit('error', m),
  plain: (m) => console.log(m),
};
