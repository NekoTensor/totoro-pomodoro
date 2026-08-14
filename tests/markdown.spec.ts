import { describe, expect, it } from 'vitest';
import { buildAppendText, formatDayHeading, formatEntry, needsDayHeading } from '../src/shared/markdown.js';
import type { LogEntryPayload } from '../src/shared/types.js';

// Local time on purpose: the log follows the user's calendar day.
const ENDED_AT = new Date(2026, 7, 15, 14, 32, 0).getTime();

function payload(overrides: Partial<LogEntryPayload> = {}): LogEntryPayload {
  return {
    outcome: 'completed',
    plannedMinutes: 25,
    elapsedMs: 25 * 60_000,
    task: 'write spec',
    endedAt: ENDED_AT,
    ...overrides,
  };
}

describe('entry formatting', () => {
  it('renders a completed session with a ticked box', () => {
    expect(formatEntry(payload())).toBe(
      '- [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "write spec" — completed',
    );
  });

  it('renders an abandoned session with an unticked box and real elapsed', () => {
    expect(formatEntry(payload({ outcome: 'abandoned', elapsedMs: 8 * 60_000 + 37_000 }))).toBe(
      '- [ ] 2026-08-15 14:32 — 25 min planned, 08:37 elapsed — "write spec" — abandoned',
    );
  });

  it('renders an interrupted session with an unticked box', () => {
    expect(formatEntry(payload({ outcome: 'interrupted' }))).toBe(
      '- [ ] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "write spec" — interrupted',
    );
  });

  it('omits the task segment entirely when there is no task', () => {
    expect(formatEntry(payload({ task: '' }))).toBe(
      '- [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — completed',
    );
  });
});

describe('day headings', () => {
  const date = new Date(ENDED_AT);

  it('formats as a level-two heading', () => {
    expect(formatDayHeading(date)).toBe('## 2026-08-15');
  });

  it('is needed for an empty file', () => {
    expect(needsDayHeading('', date)).toBe(true);
  });

  it('is not needed when the last heading is already today', () => {
    const tail = '## 2026-08-15\n\n- [x] earlier entry\n';
    expect(needsDayHeading(tail, date)).toBe(false);
  });

  it('is needed when the last heading is a previous day', () => {
    const tail = '## 2026-08-14\n\n- [x] yesterday\n';
    expect(needsDayHeading(tail, date)).toBe(true);
  });

  it('looks only at the last heading, not earlier ones', () => {
    const tail = '## 2026-08-15\n\n- [x] a\n\n## 2026-08-16\n\n- [x] b\n';
    expect(needsDayHeading(tail, date)).toBe(true);
  });
});

describe('append text', () => {
  it('creates the file header and first heading for a new file', () => {
    expect(buildAppendText(payload(), '', false)).toBe(
      '# Pomodoro Log\n\n## 2026-08-15\n\n' +
        '- [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "write spec" — completed\n',
    );
  });

  it('appends only the entry when the day is already open', () => {
    const tail = '# Pomodoro Log\n\n## 2026-08-15\n\n- [x] earlier\n';
    expect(buildAppendText(payload(), tail, true)).toBe(
      '- [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "write spec" — completed\n',
    );
  });

  it('does not glue the entry onto a file with no trailing newline', () => {
    const tail = '## 2026-08-15\n\n- [x] earlier';
    expect(buildAppendText(payload(), tail, true).startsWith('\n')).toBe(true);
  });
});
