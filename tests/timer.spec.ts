import { describe, expect, it } from 'vitest';
import {
  completionKind,
  elapsedMs,
  formatMMSS,
  isComplete,
  overshootMs,
  progress,
  remainingMs,
  wedgeSteps,
} from '../src/renderer/services/timer.js';

const START = 1_700_000_000_000;
const session = { startedAt: START, plannedDurationMs: 25 * 60_000 };

describe('timer engine', () => {
  it('derives elapsed, remaining and progress from wall-clock timestamps', () => {
    const halfway = START + 12.5 * 60_000;
    expect(elapsedMs(session, halfway)).toBe(12.5 * 60_000);
    expect(remainingMs(session, halfway)).toBe(12.5 * 60_000);
    expect(progress(session, halfway)).toBe(0.5);
  });

  it('is unaffected by how many frames were skipped in between', () => {
    // Simulates a renderer that was throttled and never ticked for 30s: the
    // reading depends only on `now`, so it lands exactly where it should.
    const before = remainingMs(session, START + 60_000);
    const after = remainingMs(session, START + 90_000);
    expect(before - after).toBe(30_000);
  });

  it('clamps a clock that moved backwards to zero elapsed', () => {
    expect(elapsedMs(session, START - 5_000)).toBe(0);
    expect(progress(session, START - 5_000)).toBe(0);
  });

  it('never reports more than full progress', () => {
    expect(progress(session, START + 90 * 60_000)).toBe(1);
    expect(remainingMs(session, START + 90 * 60_000)).toBe(0);
    expect(isComplete(session, START + 90 * 60_000)).toBe(true);
  });

  describe('wedge steps', () => {
    it('is empty at 0% and full at 100%', () => {
      expect(wedgeSteps(session, START)).toBe(0);
      expect(wedgeSteps(session, START + 25 * 60_000)).toBe(60);
    });

    it('is half filled at 50% elapsed', () => {
      expect(wedgeSteps(session, START + 12.5 * 60_000)).toBe(30);
    });

    it('uses 60 steps regardless of session length', () => {
      const short = { startedAt: START, plannedDurationMs: 60_000 };
      const long = { startedAt: START, plannedDurationMs: 180 * 60_000 };
      expect(wedgeSteps(short, START + 30_000)).toBe(30);
      expect(wedgeSteps(long, START + 90 * 60_000)).toBe(30);
    });
  });

  describe('completion kind', () => {
    it('fires the alarm for an ordinary expiry', () => {
      expect(completionKind(session, START + 25 * 60_000 + 250)).toBe('alarm');
    });

    it('still alarms inside the two-minute grace window', () => {
      expect(completionKind(session, START + 25 * 60_000 + 119_000)).toBe('alarm');
    });

    it('reports interrupted after a three-hour sleep', () => {
      const wake = START + 25 * 60_000 + 3 * 60 * 60_000;
      expect(completionKind(session, wake)).toBe('interrupted');
      expect(overshootMs(session, wake)).toBe(3 * 60 * 60_000);
    });
  });

  describe('formatMMSS', () => {
    it('pads to two minute digits and two second digits', () => {
      expect(formatMMSS(0)).toBe('00:00');
      expect(formatMMSS(8 * 60_000 + 37_000)).toBe('08:37');
      expect(formatMMSS(9 * 60_000 + 59_000)).toBe('09:59');
      expect(formatMMSS(25 * 60_000)).toBe('25:00');
    });

    it('renders the longest allowed session as 180:00', () => {
      expect(formatMMSS(180 * 60_000)).toBe('180:00');
    });

    it('treats negative and non-finite input as zero', () => {
      expect(formatMMSS(-1)).toBe('00:00');
      expect(formatMMSS(Number.NaN)).toBe('00:00');
    });
  });
});
