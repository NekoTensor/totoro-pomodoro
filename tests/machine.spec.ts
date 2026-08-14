import { describe, expect, it } from 'vitest';
import { hydrate, initialState, reduce, type MachineState } from '../src/renderer/state/machine.js';
import type { ActiveSession } from '../src/shared/types.js';

const NOW = 1_700_000_000_000;

function started(minutes = 25, task = 'write spec'): MachineState {
  let state = initialState();
  state = reduce(state, { type: 'SET_MINUTES', value: String(minutes) });
  state = reduce(state, { type: 'SET_TASK', value: task });
  return reduce(state, { type: 'START', now: NOW, id: 'session-1' });
}

describe('SETUP', () => {
  it('starts at 25 minutes with no task', () => {
    const state = initialState();
    expect(state.phase).toBe('SETUP');
    expect(state.minutes).toBe(25);
    expect(state.task).toBe('');
  });

  it('keeps only digits when typing minutes', () => {
    const state = reduce(initialState(), { type: 'SET_MINUTES', value: '4a5' });
    expect(state.minutes).toBe(45);
  });

  it('sanitizes the task as it is typed', () => {
    const state = reduce(initialState(), { type: 'SET_TASK', value: 'a\nb' });
    expect(state.task).toBe('a b');
  });

  it('clamps an out-of-range duration and flags the input instead of starting', () => {
    let state = reduce(initialState(), { type: 'SET_MINUTES', value: '999' });
    state = reduce(state, { type: 'START', now: NOW, id: 'x' });

    expect(state.phase).toBe('SETUP');
    expect(state.minutes).toBe(180);
    expect(state.inputError).toBe(true);
  });

  it('falls back to the default when the field is empty', () => {
    let state = reduce(initialState(), { type: 'SET_MINUTES', value: '' });
    state = reduce(state, { type: 'START', now: NOW, id: 'x' });

    expect(state.phase).toBe('SETUP');
    expect(state.minutes).toBe(25);
  });

  it('starts a session with a wall-clock timestamp', () => {
    const state = started(25);
    expect(state.phase).toBe('TIMER');
    expect(state.session).toMatchObject({
      startedAt: NOW,
      plannedDurationMs: 25 * 60_000,
      task: 'write spec',
      status: 'running',
    });
  });
});

describe('TIMER', () => {
  it('ignores ticks before the planned end', () => {
    const state = started();
    expect(reduce(state, { type: 'TICK', now: NOW + 60_000 })).toBe(state);
  });

  it('moves to ALARM at the planned end', () => {
    const state = reduce(started(), { type: 'TICK', now: NOW + 25 * 60_000 });
    expect(state.phase).toBe('ALARM');
  });

  it('skips the alarm and reports interrupted after a long sleep', () => {
    const state = reduce(started(), { type: 'TICK', now: NOW + 25 * 60_000 + 3 * 60 * 60_000 });

    expect(state.phase).toBe('LOG_PROMPT');
    expect(state.prompt?.outcome).toBe('interrupted');
    // Elapsed is clamped to what was planned, never the sleeping hours.
    expect(state.prompt?.elapsedMs).toBe(25 * 60_000);
  });

  it('abandons with the real elapsed time', () => {
    const state = reduce(started(), { type: 'CANCEL', now: NOW + 8 * 60_000 + 37_000 });

    expect(state.phase).toBe('LOG_PROMPT');
    expect(state.prompt?.outcome).toBe('abandoned');
    expect(state.prompt?.elapsedMs).toBe(8 * 60_000 + 37_000);
  });

  it('cannot start a second session while one runs', () => {
    const state = started();
    expect(reduce(state, { type: 'START', now: NOW + 1000, id: 'other' })).toBe(state);
  });
});

describe('ALARM', () => {
  it('completes with the planned duration, not the overrun', () => {
    let state = reduce(started(), { type: 'TICK', now: NOW + 25 * 60_000 });
    state = reduce(state, { type: 'DISMISS_ALARM' });

    expect(state.phase).toBe('LOG_PROMPT');
    expect(state.prompt?.outcome).toBe('completed');
    expect(state.prompt?.elapsedMs).toBe(25 * 60_000);
    expect(state.prompt?.endedAt).toBe(NOW + 25 * 60_000);
  });
});

describe('LOG_PROMPT', () => {
  function atPrompt(): MachineState {
    return reduce(reduce(started(), { type: 'TICK', now: NOW + 25 * 60_000 }), {
      type: 'DISMISS_ALARM',
    });
  }

  it('records a failure without losing the prompt', () => {
    const state = reduce(atPrompt(), { type: 'LOG_FAILED', message: 'PERMISSION_DENIED' });
    expect(state.phase).toBe('LOG_PROMPT');
    expect(state.logError).toBe('PERMISSION_DENIED');
    expect(state.prompt).not.toBeNull();
  });

  it('returns to SETUP retaining minutes but clearing the task', () => {
    const state = reduce(atPrompt(), { type: 'RESOLVE' });

    expect(state.phase).toBe('SETUP');
    expect(state.minutes).toBe(25);
    expect(state.task).toBe('');
    expect(state.session).toBeNull();
    expect(state.prompt).toBeNull();
    expect(state.logError).toBeNull();
  });
});

describe('illegal transitions are no-ops', () => {
  it('ignores events that do not belong to the current phase', () => {
    const setup = initialState();
    expect(reduce(setup, { type: 'TICK', now: NOW })).toBe(setup);
    expect(reduce(setup, { type: 'CANCEL', now: NOW })).toBe(setup);
    expect(reduce(setup, { type: 'DISMISS_ALARM' })).toBe(setup);
    expect(reduce(setup, { type: 'RESOLVE' })).toBe(setup);

    const timer = started();
    expect(reduce(timer, { type: 'DISMISS_ALARM' })).toBe(timer);
    expect(reduce(timer, { type: 'SET_TASK', value: 'nope' })).toBe(timer);
    expect(reduce(timer, { type: 'SET_MINUTES', value: '5' })).toBe(timer);
  });
});

describe('recovery on launch', () => {
  const session: ActiveSession = {
    id: 'saved',
    startedAt: NOW,
    plannedDurationMs: 25 * 60_000,
    task: 'write spec',
    status: 'running',
  };

  it('lands in SETUP with nothing persisted', () => {
    expect(hydrate(null, null, NOW).phase).toBe('SETUP');
  });

  it('resumes a live session from its original timestamp, not from zero', () => {
    const state = hydrate(session, null, NOW + 10 * 60_000);

    expect(state.phase).toBe('TIMER');
    expect(state.session?.startedAt).toBe(NOW);
    expect(state.minutes).toBe(25);
  });

  it('alarms if the end passed moments ago', () => {
    expect(hydrate(session, null, NOW + 25 * 60_000 + 5_000).phase).toBe('ALARM');
  });

  it('reports interrupted if the end passed long ago', () => {
    const state = hydrate(session, null, NOW + 5 * 60 * 60_000);

    expect(state.phase).toBe('LOG_PROMPT');
    expect(state.prompt?.outcome).toBe('interrupted');
    expect(state.prompt?.elapsedMs).toBe(25 * 60_000);
  });

  it('restores an unanswered prompt ahead of any session', () => {
    const prompt = {
      id: 'saved',
      startedAt: NOW,
      endedAt: NOW + 25 * 60_000,
      plannedDurationMs: 25 * 60_000,
      task: 'write spec',
      outcome: 'completed' as const,
      elapsedMs: 25 * 60_000,
    };

    const state = hydrate(session, prompt, NOW + 60 * 60_000);
    expect(state.phase).toBe('LOG_PROMPT');
    expect(state.prompt).toEqual(prompt);
  });
});
