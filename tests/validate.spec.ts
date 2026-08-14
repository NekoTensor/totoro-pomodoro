import { describe, expect, it } from 'vitest';
import {
  clampMinutes,
  coerceAppState,
  isActiveSession,
  isLogEntryPayload,
  isPendingPrompt,
  isValidMinutes,
  sanitizeTask,
} from '../src/shared/validate.js';

const NOW = 1_700_000_000_000;

function validSession() {
  return {
    id: 'abc',
    startedAt: NOW - 60_000,
    plannedDurationMs: 25 * 60_000,
    task: 'write spec',
    status: 'running',
  };
}

describe('minutes validation', () => {
  it('accepts the whole allowed range', () => {
    expect(isValidMinutes(1)).toBe(true);
    expect(isValidMinutes(25)).toBe(true);
    expect(isValidMinutes(180)).toBe(true);
  });

  it('rejects out-of-range, fractional and non-numeric values', () => {
    for (const bad of [0, 181, -1, 1.5, Number.NaN, '25', null, undefined, {}]) {
      expect(isValidMinutes(bad)).toBe(false);
    }
  });

  it('clamps rather than rejecting', () => {
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(500)).toBe(180);
    expect(clampMinutes('42')).toBe(42);
    expect(clampMinutes('abc', 25)).toBe(25);
  });
});

describe('task sanitization', () => {
  it('truncates to 24 characters', () => {
    expect(sanitizeTask('x'.repeat(50))).toHaveLength(24);
  });

  it('strips newlines so a task cannot inject a Markdown list item', () => {
    const attack = 'ok\n- [x] fake entry';
    const cleaned = sanitizeTask(attack);
    expect(cleaned).not.toContain('\n');
    expect(cleaned).toBe('ok - [x] fake entry');
  });

  it('strips carriage returns, tabs and NUL', () => {
    const cleaned = sanitizeTask(['a', String.fromCharCode(13), 'b', String.fromCharCode(9), 'c', String.fromCharCode(0), 'd'].join(''));
    expect(cleaned).toBe('a b c d');
  });

  it('replaces double quotes so the quoted segment cannot be broken', () => {
    expect(sanitizeTask('say "hi"')).toBe("say 'hi'");
  });

  it('collapses whitespace runs and trims', () => {
    expect(sanitizeTask('  a    b  ')).toBe('a b');
  });

  it('returns an empty string for non-strings', () => {
    expect(sanitizeTask(null)).toBe('');
    expect(sanitizeTask(42)).toBe('');
  });
});

describe('IPC payload guards', () => {
  it('accepts a well-formed log payload', () => {
    expect(
      isLogEntryPayload({
        outcome: 'completed',
        plannedMinutes: 25,
        elapsedMs: 1_500_000,
        task: 'x',
        endedAt: NOW,
      }),
    ).toBe(true);
  });

  it('rejects unknown outcomes, bad ranges and wrong types', () => {
    const base = { outcome: 'completed', plannedMinutes: 25, elapsedMs: 0, task: '', endedAt: NOW };
    expect(isLogEntryPayload({ ...base, outcome: 'finished' })).toBe(false);
    expect(isLogEntryPayload({ ...base, plannedMinutes: 999 })).toBe(false);
    expect(isLogEntryPayload({ ...base, elapsedMs: -1 })).toBe(false);
    expect(isLogEntryPayload({ ...base, task: 'x'.repeat(25) })).toBe(false);
    expect(isLogEntryPayload({ ...base, endedAt: 'now' })).toBe(false);
    expect(isLogEntryPayload(null)).toBe(false);
    expect(isLogEntryPayload([])).toBe(false);
  });

  it('rejects an elapsed time beyond the longest allowed session', () => {
    // This rejection happens before anything is spooled, so it used to fail
    // with no trace on disk at all.
    const base = { outcome: 'abandoned', plannedMinutes: 25, task: '', endedAt: NOW };
    expect(isLogEntryPayload({ ...base, elapsedMs: 180 * 60_000 })).toBe(true);
    expect(isLogEntryPayload({ ...base, elapsedMs: 180 * 60_000 + 1 })).toBe(false);
  });

  it('validates sessions and prompts', () => {
    expect(isActiveSession(validSession())).toBe(true);
    expect(isActiveSession({ ...validSession(), status: 'paused' })).toBe(false);
    expect(isActiveSession({ ...validSession(), plannedDurationMs: 1000 })).toBe(false);

    const prompt = {
      id: 'abc',
      startedAt: NOW - 60_000,
      endedAt: NOW,
      plannedDurationMs: 25 * 60_000,
      task: '',
      outcome: 'abandoned',
      elapsedMs: 60_000,
    };
    expect(isPendingPrompt(prompt)).toBe(true);
    expect(isPendingPrompt({ ...prompt, outcome: 'nope' })).toBe(false);
  });
});

describe('persisted state coercion', () => {
  it('round-trips a valid state', () => {
    const state = {
      version: 1,
      logDestination: { type: 'file', path: '/tmp/log.md' },
      window: { x: 10, y: 20 },
      session: validSession(),
      pendingPrompt: null,
    };
    expect(coerceAppState(state, NOW)).toEqual(state);
  });

  it('rejects a non-object or an unknown version outright', () => {
    expect(coerceAppState(null, NOW)).toBeNull();
    expect(coerceAppState('nope', NOW)).toBeNull();
    expect(coerceAppState({ version: 99 }, NOW)).toBeNull();
  });

  it('drops only the bad field, keeping the log destination', () => {
    const result = coerceAppState(
      {
        version: 1,
        logDestination: { type: 'folder', path: '/logs' },
        window: { x: 'left', y: 3 },
        session: { id: '', startedAt: -5 },
        pendingPrompt: undefined,
      },
      NOW,
    );

    expect(result?.logDestination).toEqual({ type: 'folder', path: '/logs' });
    expect(result?.window).toBeNull();
    expect(result?.session).toBeNull();
  });

  it('discards a session claiming to start in the future', () => {
    const future = { ...validSession(), startedAt: NOW + 10 * 60_000 };
    const result = coerceAppState({ version: 1, session: future }, NOW);
    expect(result?.session).toBeNull();
  });

  it('tolerates small clock skew', () => {
    const skewed = { ...validSession(), startedAt: NOW + 5_000 };
    const result = coerceAppState({ version: 1, session: skewed }, NOW);
    expect(result?.session).not.toBeNull();
  });
});
