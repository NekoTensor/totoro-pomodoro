// The application state machine as a pure reducer:
//
//   SETUP --START--> TIMER --ELAPSED--> ALARM --DISMISS--> LOG_PROMPT --> SETUP
//                      |                                       ^
//                      +--------------- CANCEL ----------------+
//
// No side effects live here — no IPC, no audio, no timers — so every
// transition, including the awkward ones, can be asserted in a unit test.

import { DEFAULT_MINUTES, type ActiveSession, type PendingPrompt } from '../../shared/types.js';
import { clampMinutes, isValidMinutes, sanitizeTask } from '../../shared/validate.js';
import { completionKind, elapsedMs } from '../services/timer.js';

export type Phase = 'SETUP' | 'TIMER' | 'ALARM' | 'LOG_PROMPT';

export interface MachineState {
  phase: Phase;
  /** Retained across sessions, per the SETUP reset rules. */
  minutes: number;
  /** Cleared every time we return to SETUP. */
  task: string;
  session: ActiveSession | null;
  prompt: PendingPrompt | null;
  /** Set when a LOG write failed; the entry is safely spooled meanwhile. */
  logError: string | null;
  /** Drives the 2-frame jitter when the typed duration was out of range. */
  inputError: boolean;
}

export type Event =
  | { type: 'SET_MINUTES'; value: string }
  | { type: 'SET_TASK'; value: string }
  | { type: 'START'; now: number; id: string }
  | { type: 'TICK'; now: number }
  | { type: 'CANCEL'; now: number }
  | { type: 'DISMISS_ALARM' }
  | { type: 'LOG_FAILED'; message: string }
  | { type: 'RESOLVE' };

export function initialState(minutes: number = DEFAULT_MINUTES): MachineState {
  return {
    phase: 'SETUP',
    minutes,
    task: '',
    session: null,
    prompt: null,
    logError: null,
    inputError: false,
  };
}

function promptFrom(
  session: ActiveSession,
  outcome: PendingPrompt['outcome'],
  endedAt: number,
  elapsed: number,
): PendingPrompt {
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt,
    plannedDurationMs: session.plannedDurationMs,
    task: session.task,
    outcome,
    elapsedMs: elapsed,
  };
}

/** Returning to SETUP clears the task and resets progress, but keeps minutes. */
function toSetup(state: MachineState): MachineState {
  return initialState(state.minutes);
}

export function reduce(state: MachineState, event: Event): MachineState {
  switch (event.type) {
    case 'SET_MINUTES': {
      if (state.phase !== 'SETUP') return state;
      const digits = event.value.replace(/[^0-9]/g, '').slice(0, 3);
      const parsed = digits.length > 0 ? Number.parseInt(digits, 10) : Number.NaN;
      // Keep whatever was typed while typing; only START enforces the range.
      return { ...state, minutes: Number.isNaN(parsed) ? 0 : parsed, inputError: false };
    }

    case 'SET_TASK': {
      if (state.phase !== 'SETUP') return state;
      return { ...state, task: sanitizeTask(event.value) };
    }

    case 'START': {
      if (state.phase !== 'SETUP') return state;

      if (!isValidMinutes(state.minutes)) {
        // Out-of-range input is clamped rather than rejected, and flagged so
        // the number can jitter to show it was changed. An empty field falls
        // back to the default rather than to the 1-minute floor.
        const source = state.minutes > 0 ? state.minutes : DEFAULT_MINUTES;
        return { ...state, minutes: clampMinutes(source, DEFAULT_MINUTES), inputError: true };
      }

      const session: ActiveSession = {
        id: event.id,
        startedAt: event.now,
        plannedDurationMs: state.minutes * 60_000,
        task: sanitizeTask(state.task),
        status: 'running',
      };

      return { ...state, phase: 'TIMER', session, prompt: null, logError: null, inputError: false };
    }

    case 'TICK': {
      if (state.phase !== 'TIMER' || !state.session) return state;

      const session = state.session;
      const end = session.startedAt + session.plannedDurationMs;
      if (event.now < end) return state;

      // One rule covers the ordinary expiry, a frozen renderer and a laptop
      // that slept through the end.
      if (completionKind(session, event.now) === 'alarm') {
        return { ...state, phase: 'ALARM' };
      }

      return {
        ...state,
        phase: 'LOG_PROMPT',
        session: null,
        prompt: promptFrom(session, 'interrupted', end, session.plannedDurationMs),
      };
    }

    case 'CANCEL': {
      if (state.phase !== 'TIMER' || !state.session) return state;
      const session = state.session;
      return {
        ...state,
        phase: 'LOG_PROMPT',
        session: null,
        prompt: promptFrom(session, 'abandoned', event.now, elapsedMs(session, event.now)),
      };
    }

    case 'DISMISS_ALARM': {
      if (state.phase !== 'ALARM' || !state.session) return state;
      const session = state.session;
      const end = session.startedAt + session.plannedDurationMs;
      // Elapsed is the planned duration exactly: the extra seconds spent
      // ignoring the alarm are not work.
      return {
        ...state,
        phase: 'LOG_PROMPT',
        session: null,
        prompt: promptFrom(session, 'completed', end, session.plannedDurationMs),
      };
    }

    case 'LOG_FAILED': {
      if (state.phase !== 'LOG_PROMPT') return state;
      return { ...state, logError: event.message };
    }

    case 'RESOLVE': {
      if (state.phase !== 'LOG_PROMPT') return state;
      return toSetup(state);
    }

    default:
      return state;
  }
}

/**
 * Builds the starting state from whatever was persisted. A pending prompt wins
 * over a session because it represents a decision the user still owes; a live
 * session resumes from its original timestamp; an expired one becomes an
 * interrupted prompt rather than restarting from zero.
 */
export function hydrate(
  session: ActiveSession | null,
  prompt: PendingPrompt | null,
  now: number,
): MachineState {
  const base = initialState();

  if (prompt) {
    return { ...base, phase: 'LOG_PROMPT', prompt, minutes: Math.round(prompt.plannedDurationMs / 60_000) };
  }

  if (session) {
    const minutes = Math.round(session.plannedDurationMs / 60_000);
    const end = session.startedAt + session.plannedDurationMs;

    if (now < end) return { ...base, phase: 'TIMER', session, minutes };

    if (completionKind(session, now) === 'alarm') {
      return { ...base, phase: 'ALARM', session, minutes };
    }

    return {
      ...base,
      phase: 'LOG_PROMPT',
      minutes,
      prompt: promptFrom(session, 'interrupted', end, session.plannedDurationMs),
    };
  }

  return base;
}
