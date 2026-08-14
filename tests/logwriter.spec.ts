import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEntries,
  classifyError,
  enqueue,
  readSpool,
  readTail,
  writeSpool,
} from '../src/main/logwriter.js';
import type { LogEntryPayload } from '../src/shared/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'totoro-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function payload(overrides: Partial<LogEntryPayload> = {}): LogEntryPayload {
  return {
    outcome: 'completed',
    plannedMinutes: 25,
    elapsedMs: 25 * 60_000,
    task: 'write spec',
    endedAt: new Date(2026, 7, 15, 14, 32).getTime(),
    ...overrides,
  };
}

describe('appendEntries', () => {
  it('creates missing directories and the file itself', () => {
    const file = join(dir, 'nested', 'deeper', 'pomodoro-log.md');
    appendEntries(file, [payload()]);

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('# Pomodoro Log');
  });

  it('never overwrites existing content', () => {
    const file = join(dir, 'log.md');
    writeFileSync(file, '# Pomodoro Log\n\n## 2020-01-01\n\n- [x] ancient history\n');

    appendEntries(file, [payload()]);
    const contents = readFileSync(file, 'utf8');

    expect(contents).toContain('ancient history');
    expect(contents).toContain('write spec');
  });

  it('emits the day heading once for a batch on the same day', () => {
    const file = join(dir, 'log.md');
    appendEntries(file, [payload(), payload({ outcome: 'abandoned', elapsedMs: 1000 })]);

    const headings = readFileSync(file, 'utf8').match(/## 2026-08-15/g) ?? [];
    expect(headings).toHaveLength(1);
  });

  it('emits a second heading when a batch straddles two days', () => {
    const file = join(dir, 'log.md');
    appendEntries(file, [
      payload(),
      payload({ endedAt: new Date(2026, 7, 16, 9, 5).getTime() }),
    ]);

    const contents = readFileSync(file, 'utf8');
    expect(contents).toContain('## 2026-08-15');
    expect(contents).toContain('## 2026-08-16');
  });

  it('recreates the file with its header if it was deleted between sessions', () => {
    const file = join(dir, 'log.md');
    appendEntries(file, [payload()]);
    rmSync(file);
    appendEntries(file, [payload()]);

    expect(readFileSync(file, 'utf8').startsWith('# Pomodoro Log')).toBe(true);
  });

  it('throws when the destination directory cannot be used', () => {
    // A file standing where a directory is expected.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    expect(() => appendEntries(join(blocker, 'log.md'), [payload()])).toThrow();
  });
});

describe('readTail', () => {
  it('reports a missing file rather than throwing', () => {
    expect(readTail(join(dir, 'nope.md'))).toEqual({ exists: false, text: '' });
  });

  it('reads only the end of a large file', () => {
    const file = join(dir, 'big.md');
    writeFileSync(file, `${'x'.repeat(20_000)}TAIL`);
    const tail = readTail(file, 100);
    expect(tail.exists).toBe(true);
    expect(tail.text.endsWith('TAIL')).toBe(true);
    expect(tail.text.length).toBe(100);
  });
});

describe('spool', () => {
  it('starts empty and round-trips entries', () => {
    const spool = join(dir, 'pending.json');
    expect(readSpool(spool)).toEqual([]);

    writeSpool(spool, [payload()]);
    expect(readSpool(spool)).toHaveLength(1);
  });

  it('queues an entry before any write is attempted', () => {
    const spool = join(dir, 'pending.json');
    const queued = enqueue(spool, payload());
    expect(queued).toHaveLength(1);
    expect(readSpool(spool)).toHaveLength(1);
  });

  it('does not double-queue an identical retry', () => {
    const spool = join(dir, 'pending.json');
    enqueue(spool, payload());
    const second = enqueue(spool, payload());

    expect(second).toHaveLength(1);
    expect(readSpool(spool)).toHaveLength(1);
  });

  it('queues genuinely different sessions separately', () => {
    const spool = join(dir, 'pending.json');
    enqueue(spool, payload());
    enqueue(spool, payload({ endedAt: payload().endedAt + 1000 }));
    expect(readSpool(spool)).toHaveLength(2);
  });

  it('preserves queue order when flushed', () => {
    const file = join(dir, 'log.md');
    const spool = join(dir, 'pending.json');

    enqueue(spool, payload({ task: 'first' }));
    enqueue(spool, payload({ task: 'second', endedAt: payload().endedAt + 1000 }));
    appendEntries(file, readSpool(spool));

    const contents = readFileSync(file, 'utf8');
    expect(contents.indexOf('first')).toBeLessThan(contents.indexOf('second'));
  });

  it('drops a corrupt spool rather than blocking logging', () => {
    const spool = join(dir, 'pending.json');
    writeFileSync(spool, '{ this is not json');
    expect(readSpool(spool)).toEqual([]);
  });

  it('discards queued entries that no longer validate', () => {
    const spool = join(dir, 'pending.json');
    writeFileSync(spool, JSON.stringify([payload(), { outcome: 'bogus' }]));
    expect(readSpool(spool)).toHaveLength(1);
  });
});

describe('error classification', () => {
  it('maps errno codes to actionable reasons', () => {
    expect(classifyError({ code: 'EACCES' })).toBe('PERMISSION_DENIED');
    expect(classifyError({ code: 'EPERM' })).toBe('PERMISSION_DENIED');
    expect(classifyError({ code: 'ENOENT' })).toBe('PATH_NOT_FOUND');
    expect(classifyError({ code: 'ENOTDIR' })).toBe('NOT_A_DIRECTORY');
    expect(classifyError({ code: 'ENOSPC' })).toBe('DISK_FULL');
    expect(classifyError(new Error('boom'))).toBe('UNKNOWN');
  });
});

describe('folder destinations', () => {
  it('writes pomodoro-log.md inside a chosen folder', () => {
    const folder = join(dir, 'journal');
    mkdirSync(folder);
    const file = join(folder, 'pomodoro-log.md');

    appendEntries(file, [payload()]);
    expect(existsSync(file)).toBe(true);
  });
});
