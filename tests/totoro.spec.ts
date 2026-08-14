import { describe, expect, it } from 'vitest';
import { buildTotoroMarkup } from '../src/renderer/components/totoro.js';
import { buildWedgeCells } from '../src/renderer/components/dial.js';
import { WEDGE_STEPS } from '../src/shared/types.js';

describe('character markup', () => {
  const markup = buildTotoroMarkup();

  it('never uses id="totoro"', () => {
    // HTML named access mirrors every element id onto `window`. An element
    // with id="totoro" shadows the preload's window.totoro bridge with a DOM
    // node, which silently breaks saving and makes the inert fallback
    // unreachable. Regression guard.
    expect(markup).not.toMatch(/id="totoro"/);
    expect(markup).toContain('id="totoro-character"');
  });

  it('renders on the pixel grid with no anti-aliasing', () => {
    expect(markup).toContain('shape-rendering="crispEdges"');
  });

  it('uses no gradients, filters, blur or external images', () => {
    for (const banned of ['<image', 'linearGradient', 'radialGradient', 'filter=', 'blur(']) {
      expect(markup).not.toContain(banned);
    }
  });

  it('fills the specified 280x340 window', () => {
    expect(markup).toContain('viewBox="0 0 280 340"');
  });
});

describe('dial geometry', () => {
  const cells = buildWedgeCells();

  it('covers every one of the 60 steps', () => {
    const steps = new Set(cells.map((cell) => cell.step));
    expect(steps.size).toBe(WEDGE_STEPS);
  });

  it('starts at 12 o_clock and grows clockwise', () => {
    const first = cells.filter((cell) => cell.step === 0);
    const quarter = cells.filter((cell) => cell.step === WEDGE_STEPS / 4);

    // Step 0 sits above the centre; a quarter turn later it is to the right.
    expect(Math.min(...first.map((c) => c.y))).toBeLessThan(218);
    expect(Math.max(...quarter.map((c) => c.x))).toBeGreaterThan(140);
  });
});
