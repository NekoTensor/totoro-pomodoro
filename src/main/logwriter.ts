// Filesystem side of logging. Deliberately free of any Electron import so the
// whole append/spool mechanism can be unit-tested against a temp directory.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeSync, fsyncSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildAppendText } from '../shared/markdown.js';
import { isLogEntryPayload } from '../shared/validate.js';
import type { LogEntryPayload, LogErrorCode } from '../shared/types.js';

/** How much of the file's end we read to find the most recent day heading. */
export const TAIL_BYTES = 8192;

export interface Tail {
  exists: boolean;
  text: string;
}

/**
 * Reads only the last `TAIL_BYTES` of the log. The file grows forever, so it
 * is never read in full; the day heading we care about is always at the end.
 */
export function readTail(filePath: string, maxBytes: number = TAIL_BYTES): Tail {
  if (!existsSync(filePath)) return { exists: false, text: '' };

  const size = statSync(filePath).size;
  const length = Math.min(size, maxBytes);
  if (length === 0) return { exists: true, text: '' };

  const buffer = Buffer.allocUnsafe(length);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }

  return { exists: true, text: buffer.toString('utf8') };
}

/**
 * Builds the text for a batch of entries as if appended one after another,
 * carrying the growing tail forward so a second entry on the same day does not
 * repeat the day heading.
 */
export function buildBatchAppend(
  payloads: readonly LogEntryPayload[],
  tail: Tail,
): string {
  let text = tail.exists ? tail.text : '';
  let exists = tail.exists;
  let out = '';

  for (const payload of payloads) {
    const chunk = buildAppendText(payload, text, exists);
    out += chunk;
    text = (text + chunk).slice(-TAIL_BYTES);
    exists = true;
  }

  return out;
}

/**
 * Appends entries to the log, creating parent directories and the file itself
 * when missing. Pure append — existing bytes are never rewritten. Throws on
 * failure so the caller can keep the spool intact.
 */
export function appendEntries(filePath: string, payloads: readonly LogEntryPayload[]): void {
  if (payloads.length === 0) return;

  mkdirSync(dirname(filePath), { recursive: true });
  const tail = readTail(filePath);
  appendFileSync(filePath, buildBatchAppend(payloads, tail), 'utf8');
}

function entryKey(payload: LogEntryPayload): string {
  return [payload.endedAt, payload.outcome, payload.elapsedMs, payload.plannedMinutes, payload.task].join('|');
}

/** Reads queued entries, discarding anything that no longer validates. */
export function readSpool(spoolFile: string): LogEntryPayload[] {
  if (!existsSync(spoolFile)) return [];

  try {
    const parsed: unknown = JSON.parse(readFileSync(spoolFile, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLogEntryPayload);
  } catch {
    // A corrupt spool must not block logging; drop it and carry on.
    return [];
  }
}

export function writeSpool(spoolFile: string, entries: readonly LogEntryPayload[]): void {
  const tmp = `${spoolFile}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, `${JSON.stringify(entries, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, spoolFile);
}

/**
 * Queues an entry, skipping it if an identical one is already queued. The
 * dedupe is what makes RETRY safe: pressing it re-sends the same payload, and
 * without this the entry would be written twice once the path is fixed.
 */
export function enqueue(spoolFile: string, payload: LogEntryPayload): LogEntryPayload[] {
  const queued = readSpool(spoolFile);
  const key = entryKey(payload);
  if (!queued.some((entry) => entryKey(entry) === key)) queued.push(payload);
  writeSpool(spoolFile, queued);
  return queued;
}

export function classifyError(error: unknown): LogErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'PERMISSION_DENIED';
    case 'ENOENT':
      return 'PATH_NOT_FOUND';
    case 'ENOTDIR':
    case 'EISDIR':
      return 'NOT_A_DIRECTORY';
    case 'ENOSPC':
      return 'DISK_FULL';
    default:
      return 'UNKNOWN';
  }
}
