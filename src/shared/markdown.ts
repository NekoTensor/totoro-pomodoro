// Markdown rendering for the session log. Pure string work: no filesystem
// access here, so the exact output can be asserted byte-for-byte in tests.

import { formatLocalDate, formatLocalTime, formatMMSS } from './format.js';
import type { LogEntryPayload } from './types.js';

/** Written once when the log file is first created. */
export const FILE_HEADER = '# Pomodoro Log\n';

/** The em dash separating each field of an entry, per the spec. */
const SEP = '—';

export function formatDayHeading(date: Date): string {
  return `## ${formatLocalDate(date)}`;
}

/**
 * Builds a single log line.
 *
 *   - [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "task" — completed
 *   - [ ] 2026-08-15 14:32 — 25 min planned, 08:37 elapsed — "task" — abandoned
 *   - [ ] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "task" — interrupted
 *   - [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — completed
 *
 * Only a completed session gets a ticked box. The task segment disappears
 * entirely when there is no task, rather than rendering empty quotes.
 *
 * The caller is responsible for having sanitized `task` (see sanitizeTask);
 * this function does not re-escape, it only assembles.
 */
export function formatEntry(payload: LogEntryPayload): string {
  const at = new Date(payload.endedAt);
  const box = payload.outcome === 'completed' ? '[x]' : '[ ]';
  const stamp = `${formatLocalDate(at)} ${formatLocalTime(at)}`;
  const planned = `${payload.plannedMinutes} min planned`;
  const elapsed = `${formatMMSS(payload.elapsedMs)} elapsed`;
  const task = payload.task.length > 0 ? ` ${SEP} "${payload.task}"` : '';

  return `- ${box} ${stamp} ${SEP} ${planned}, ${elapsed}${task} ${SEP} ${payload.outcome}`;
}

/**
 * Decides whether a `## YYYY-MM-DD` heading must be emitted before the next
 * entry, given the tail of the existing file. Only the LAST heading in the
 * tail matters: if it already names today, the day is open and the entry can
 * simply be appended.
 */
export function needsDayHeading(existingTail: string, date: Date): boolean {
  const target = formatDayHeading(date);
  const lines = existingTail.split(/\r?\n/);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trimEnd();
    if (line.startsWith('## ')) return line !== target;
  }

  return true;
}

/**
 * Assembles exactly the text to append to the log file, given what is already
 * there. Returns a string that always ends in a newline and never rewrites a
 * single existing byte.
 */
export function buildAppendText(
  payload: LogEntryPayload,
  existingTail: string,
  fileExists: boolean,
): string {
  const at = new Date(payload.endedAt);
  const parts: string[] = [];

  if (!fileExists) {
    parts.push(FILE_HEADER);
  } else if (existingTail.length > 0 && !existingTail.endsWith('\n')) {
    // The file was left without a trailing newline; don't glue our entry onto
    // the end of somebody else's line.
    parts.push('\n');
  }

  if (needsDayHeading(fileExists ? existingTail : '', at)) {
    parts.push(`\n${formatDayHeading(at)}\n\n`);
  }

  parts.push(`${formatEntry(payload)}\n`);

  return parts.join('');
}
