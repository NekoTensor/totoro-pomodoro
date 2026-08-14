// Pure validation helpers. Used by the renderer for input handling AND by the
// main process to re-validate every IPC payload. The renderer is treated as
// untrusted, so nothing here may be skipped on the main side.

import {
  MAX_MINUTES,
  MAX_TASK_LENGTH,
  MIN_MINUTES,
  type ActiveSession,
  type AppState,
  type LogDestination,
  type LogEntryPayload,
  type PendingPrompt,
  type PersistedWindowPosition,
  type SessionOutcome,
} from './types.js';

/** Tolerance for a `startedAt` that sits slightly in the future (clock drift). */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/** Longest session, used as the upper sanity bound on persisted durations. */
export const MAX_DURATION_MS = MAX_MINUTES * 60_000;

/** Shortest session, mirroring MIN_MINUTES. */
export const MIN_DURATION_MS = MIN_MINUTES * 60_000;

const OUTCOMES: readonly SessionOutcome[] = ['completed', 'abandoned', 'interrupted'];

const SPACE = 0x20;
const DELETE_CHAR = 0x7f;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True only for whole numbers inside the allowed 1..180 range. */
export function isValidMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_MINUTES &&
    value <= MAX_MINUTES
  );
}

/** Coerces anything into the legal range; non-numeric input falls back to `fallback`. */
export function clampMinutes(value: unknown, fallback: number = MIN_MINUTES): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  const whole = Math.trunc(parsed);
  if (whole < MIN_MINUTES) return MIN_MINUTES;
  if (whole > MAX_MINUTES) return MAX_MINUTES;
  return whole;
}

/**
 * Makes a task string safe to embed mid-line in Markdown and short enough for
 * the belly. Every control character (newline, CR, tab, NUL, DEL) becomes a
 * space so nothing can inject a new list item or break the line; double quotes
 * become single ones so the quoted segment cannot be broken; whitespace runs
 * collapse; then it is truncated to the belly's limit.
 *
 * Code points are filtered explicitly rather than by regex to keep literal
 * control characters out of this source file.
 */
export function sanitizeTask(value: unknown): string {
  if (typeof value !== 'string') return '';

  let stripped = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isControl = code < SPACE || code === DELETE_CHAR;
    stripped += isControl ? ' ' : char;
  }

  return stripped
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TASK_LENGTH);
}

export function isLogDestination(value: unknown): value is LogDestination {
  if (!isPlainObject(value)) return false;
  if (value.type !== 'file' && value.type !== 'folder') return false;
  return typeof value.path === 'string' && value.path.length > 0;
}

export function isSessionOutcome(value: unknown): value is SessionOutcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

export function isLogEntryPayload(value: unknown): value is LogEntryPayload {
  if (!isPlainObject(value)) return false;
  if (!isSessionOutcome(value.outcome)) return false;
  if (!isValidMinutes(value.plannedMinutes)) return false;
  if (!isNonNegativeInt(value.elapsedMs)) return false;
  if (value.elapsedMs > MAX_DURATION_MS) return false;
  if (typeof value.task !== 'string' || value.task.length > MAX_TASK_LENGTH) return false;
  if (!isNonNegativeInt(value.endedAt)) return false;
  return true;
}

export function isActiveSession(value: unknown): value is ActiveSession {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 64) return false;
  if (!isNonNegativeInt(value.startedAt) || value.startedAt === 0) return false;
  if (!isNonNegativeInt(value.plannedDurationMs)) return false;
  if (value.plannedDurationMs < MIN_DURATION_MS || value.plannedDurationMs > MAX_DURATION_MS) {
    return false;
  }
  if (typeof value.task !== 'string' || value.task.length > MAX_TASK_LENGTH) return false;
  if (value.status !== 'running') return false;
  return true;
}

export function isPendingPrompt(value: unknown): value is PendingPrompt {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 64) return false;
  if (!isNonNegativeInt(value.startedAt) || value.startedAt === 0) return false;
  if (!isNonNegativeInt(value.endedAt)) return false;
  if (!isNonNegativeInt(value.plannedDurationMs)) return false;
  if (value.plannedDurationMs < MIN_DURATION_MS || value.plannedDurationMs > MAX_DURATION_MS) {
    return false;
  }
  if (typeof value.task !== 'string' || value.task.length > MAX_TASK_LENGTH) return false;
  if (!isSessionOutcome(value.outcome)) return false;
  if (!isNonNegativeInt(value.elapsedMs) || value.elapsedMs > MAX_DURATION_MS) return false;
  return true;
}

function isWindowPosition(value: unknown): value is PersistedWindowPosition {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y)
  );
}

export function defaultAppState(): AppState {
  return { version: 1, logDestination: null, window: null, session: null, pendingPrompt: null };
}

/**
 * Rebuilds an AppState from untrusted JSON. Anything that fails validation is
 * dropped field-by-field rather than rejecting the whole file, so one bad
 * session record never costs the user their log destination. Returns null only
 * when the value isn't a state object at all.
 */
export function coerceAppState(value: unknown, now: number = Date.now()): AppState | null {
  if (!isPlainObject(value)) return null;
  if (value.version !== 1) return null;

  const state = defaultAppState();

  if (isLogDestination(value.logDestination)) state.logDestination = value.logDestination;
  if (isWindowPosition(value.window)) state.window = value.window;

  // A session claiming to have started meaningfully in the future means the
  // clock moved; it cannot be reasoned about, so it is discarded.
  if (isActiveSession(value.session) && value.session.startedAt <= now + CLOCK_SKEW_TOLERANCE_MS) {
    state.session = value.session;
  }

  if (
    isPendingPrompt(value.pendingPrompt) &&
    value.pendingPrompt.startedAt <= now + CLOCK_SKEW_TOLERANCE_MS
  ) {
    state.pendingPrompt = value.pendingPrompt;
  }

  return state;
}
