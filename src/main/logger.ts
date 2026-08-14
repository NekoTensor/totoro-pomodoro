// Electron-aware logging façade. All the risky filesystem work lives in
// logwriter.ts; this module only resolves paths and owns the spool policy.

import { appendEntries, classifyError, enqueue, readSpool, writeSpool } from './logwriter.js';
import { defaultLogDestination, resolveLogFile, spoolPath } from './paths.js';
import { getState, patchState } from './persistence.js';
import type { LogDestination, LogEntryPayload, LogResult } from '../shared/types.js';

/**
 * The destination in force. On first use this materializes the default and
 * persists it, so the choice is visible in state.json rather than being an
 * invisible fallback that could drift between versions.
 */
export function currentDestination(): LogDestination {
  const existing = getState().logDestination;
  if (existing) return existing;

  const fallback = defaultLogDestination();
  patchState({ logDestination: fallback });
  return fallback;
}

export function currentLogFile(): string {
  return resolveLogFile(currentDestination());
}

/**
 * Queues the entry durably, then tries to write everything outstanding in
 * order. The spool write happens BEFORE the append attempt, so an entry
 * survives even a force-kill in the middle of the write.
 *
 * Retrying is safe: enqueue() dedupes an identical payload, so pressing RETRY
 * cannot double-write the session.
 */
export function appendLog(payload: LogEntryPayload): LogResult {
  const file = currentLogFile();
  const spool = spoolPath();

  let queued: LogEntryPayload[];
  try {
    queued = enqueue(spool, payload);
  } catch (error) {
    // If even the spool is unwritable we still attempt the real log rather
    // than dropping the session on the floor.
    console.error('[logger] could not write spool', error);
    queued = [payload];
  }

  try {
    appendEntries(file, queued);
  } catch (error) {
    return {
      ok: false,
      code: classifyError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    writeSpool(spool, []);
  } catch (error) {
    // The entries are safely in the log; a stale spool would only cause a
    // duplicate later, so surface it loudly but don't fail the operation.
    console.error('[logger] wrote log but could not clear spool', error);
  }

  return { ok: true, path: file, flushed: queued.length };
}

/**
 * Best-effort flush of anything left queued by a previous run. Called at
 * launch and after the destination changes. Silent on failure — the entries
 * stay queued for the next opportunity.
 */
export function flushSpool(): number {
  const spool = spoolPath();
  const queued = readSpool(spool);
  if (queued.length === 0) return 0;

  try {
    appendEntries(currentLogFile(), queued);
    writeSpool(spool, []);
    console.log(`[logger] flushed ${queued.length} queued entr${queued.length === 1 ? 'y' : 'ies'}`);
    return queued.length;
  } catch (error) {
    console.warn('[logger] queued entries still pending', error);
    return 0;
  }
}

export function pendingCount(): number {
  return readSpool(spoolPath()).length;
}
