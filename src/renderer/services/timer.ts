// The timer engine. Pure timestamp arithmetic with no DOM, Electron or module
// state, so it is exhaustively unit-testable and immune to dropped frames.
//
// Nothing here is ever decremented: every value is derived from `now` against
// the session's original `startedAt`. That is what keeps the countdown correct
// across backgrounding, throttling, window drags, sleep and crashes.

import { ALARM_GRACE_MS, WEDGE_STEPS } from '../../shared/types.js';

export { formatMMSS } from '../../shared/format.js';

export interface Timing {
  startedAt: number;
  plannedDurationMs: number;
}

export function elapsedMs(timing: Timing, now: number): number {
  return Math.max(0, now - timing.startedAt);
}

export function remainingMs(timing: Timing, now: number): number {
  return Math.max(0, timing.plannedDurationMs - elapsedMs(timing, now));
}

export function progress(timing: Timing, now: number): number {
  if (timing.plannedDurationMs <= 0) return 1;
  return Math.min(1, elapsedMs(timing, now) / timing.plannedDurationMs);
}

/** How many of the 60 dial steps are lit. Reaches 60 only at full elapse. */
export function wedgeSteps(timing: Timing, now: number): number {
  return Math.min(WEDGE_STEPS, Math.floor(progress(timing, now) * WEDGE_STEPS));
}

export function isComplete(timing: Timing, now: number): boolean {
  return remainingMs(timing, now) <= 0;
}

/** How far past the planned end we are — 0 while the session is still running. */
export function overshootMs(timing: Timing, now: number): number {
  return Math.max(0, now - (timing.startedAt + timing.plannedDurationMs));
}

/**
 * What a finished session should do. Within the grace window the machine was
 * simply running and the alarm is due; beyond it the machine was asleep or
 * frozen, so the session is reported as interrupted rather than beeping about
 * something that ended hours ago.
 */
export function completionKind(timing: Timing, now: number): 'alarm' | 'interrupted' {
  return overshootMs(timing, now) <= ALARM_GRACE_MS ? 'alarm' : 'interrupted';
}
