// Durable app state. Writes are atomic (temp file, fsync, rename) so a crash
// or power loss mid-write can never leave a half-written state.json behind,
// and they are debounced so a running session doesn't hammer the disk.

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { coerceAppState, defaultAppState } from '../shared/validate.js';
import type { AppState } from '../shared/types.js';
import { statePath } from './paths.js';

const WRITE_DEBOUNCE_MS = 250;

let cache: AppState = defaultAppState();
let timer: NodeJS.Timeout | null = null;
let dirty = false;

/** Renames an unreadable state file aside so the next launch starts clean. */
function quarantine(path: string, reason: string): void {
  try {
    const stamped = `${path.replace(/\.json$/, '')}.corrupt-${Date.now()}.json`;
    renameSync(path, stamped);
    console.warn(`[persistence] quarantined unreadable state (${reason}) -> ${stamped}`);
  } catch (error) {
    console.warn('[persistence] could not quarantine state file', error);
  }
}

function writeAtomic(path: string, contents: string): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Loads state from disk. Malformed JSON, an unknown version or values that
 * fail validation never throw: the file is quarantined and defaults are used,
 * because a corrupt state file must not prevent the app from starting.
 */
export function loadState(): AppState {
  const path = statePath();
  let raw: string;

  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.warn('[persistence] could not read state', error);
    cache = defaultAppState();
    return cache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(path, 'invalid JSON');
    cache = defaultAppState();
    return cache;
  }

  const coerced = coerceAppState(parsed);
  if (!coerced) {
    quarantine(path, 'unrecognized shape or version');
    cache = defaultAppState();
    return cache;
  }

  cache = coerced;
  return cache;
}

export function getState(): AppState {
  return cache;
}

/** Merges a patch into state and schedules a debounced atomic write. */
export function patchState(patch: Partial<AppState>): void {
  cache = { ...cache, ...patch };
  dirty = true;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushState();
  }, WRITE_DEBOUNCE_MS);
}

/** Writes immediately if there are pending changes. Safe to call any time. */
export function flushState(): void {
  if (!dirty) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  try {
    writeAtomic(statePath(), `${JSON.stringify(cache, null, 2)}\n`);
    dirty = false;
  } catch (error) {
    // Keep `dirty` set so a later flush (e.g. on quit) tries again.
    console.error('[persistence] failed to write state', error);
  }
}
