// Geometry for the belly timer: a 108px circle whose elapsed wedge grows
// clockwise from 12 o'clock in 60 fixed steps, independent of session length.
//
// The wedge is drawn as a grid of 4px cells rather than as arcs or thin
// triangles. Sweeping an arc produces a smooth pie; quantizing to a pixel grid
// is what makes it read as pixel art while keeping exactly 60 discrete steps.

import { WEDGE_STEPS } from '../../shared/types.js';
import { PALETTE } from './palette.js';

export const DIAL_CENTER_X = 140;
export const DIAL_CENTER_Y = 218;
/** Outer radius — 108px across, per the spec. */
export const DIAL_RADIUS = 54;
/** Rim thickness, leaving the interior for the wedge. */
export const DIAL_RIM = 6;
export const WEDGE_RADIUS = DIAL_RADIUS - DIAL_RIM - 2;

/** Size of one wedge pixel. Larger reads chunkier; 4 matches the body's steps. */
export const WEDGE_PIXEL = 4;

const DEGREES_PER_STEP = 360 / WEDGE_STEPS;

export interface WedgeCell {
  x: number;
  y: number;
  step: number;
}

/**
 * Every cell of the wedge grid, tagged with the step at which it lights up.
 *
 * The angle is measured from 12 o'clock and increases clockwise, matching the
 * direction the wedge grows.
 */
export function buildWedgeCells(): WedgeCell[] {
  const cells: WedgeCell[] = [];
  const radius = WEDGE_RADIUS;

  for (let y = DIAL_CENTER_Y - radius; y < DIAL_CENTER_Y + radius; y += WEDGE_PIXEL) {
    for (let x = DIAL_CENTER_X - radius; x < DIAL_CENTER_X + radius; x += WEDGE_PIXEL) {
      const centerX = x + WEDGE_PIXEL / 2;
      const centerY = y + WEDGE_PIXEL / 2;
      const dx = centerX - DIAL_CENTER_X;
      const dy = centerY - DIAL_CENTER_Y;

      if (Math.hypot(dx, dy) > radius) continue;

      // atan2(dx, -dy) puts 0 at 12 o'clock and grows clockwise.
      let degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (degrees < 0) degrees += 360;

      const step = Math.min(WEDGE_STEPS - 1, Math.floor(degrees / DEGREES_PER_STEP));
      cells.push({ x, y, step });
    }
  }

  return cells;
}

export function buildDialMarkup(): string {
  const cells = buildWedgeCells()
    .map(
      (cell) =>
        `<rect class="wedge-step" data-step="${cell.step}" x="${cell.x}" y="${cell.y}" ` +
        `width="${WEDGE_PIXEL}" height="${WEDGE_PIXEL}" />`,
    )
    .join('');

  return `
    <g id="dial">
      <circle cx="${DIAL_CENTER_X}" cy="${DIAL_CENTER_Y}" r="${DIAL_RADIUS}" fill="${PALETTE.outline}" />
      <circle
        id="dial-interior"
        cx="${DIAL_CENTER_X}"
        cy="${DIAL_CENTER_Y}"
        r="${DIAL_RADIUS - DIAL_RIM}"
        fill="${PALETTE.bodyShadow}"
      />
      <g id="dial-wedge">${cells}</g>
      <circle
        cx="${DIAL_CENTER_X}"
        cy="${DIAL_CENTER_Y}"
        r="${DIAL_RADIUS - DIAL_RIM}"
        fill="none"
        stroke="${PALETTE.outline}"
        stroke-width="2"
      />
    </g>`;
}
