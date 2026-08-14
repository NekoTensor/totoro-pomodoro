// Totoro, built entirely from axis-aligned rectangles on integer coordinates.
//
// Every contour is a run of rows rather than a curve, which is what produces
// the stepped pixel-art silhouette. No paths, filters, gradients or images.
//
// Proportions follow the classic pixel Totoro: a rounded pear-shaped body that
// is widest low down, two tall narrow ears, and a very large pale belly that
// takes up most of the front.

import { buildDialMarkup } from './dial.js';
import { PALETTE } from './palette.js';

export { PALETTE };

const CENTER_X = 140;

/**
 * Body silhouette: half-width of each 10px row, head down to feet. Narrow at
 * the top, widest around two-thirds down, tapering slightly at the base.
 */
const BODY_TOP = 84;
const BODY_ROW = 10;
const BODY_HALF_WIDTHS = [
  58, 72, 82, 89, 95, 100, 104, 108, 111, 114, 116, 118, 119, 119, 119, 118, 116, 113, 109, 104,
  97, 87, 72,
];

/** The big pale belly: half-width of each 10px row. Nearly fills the body. */
const BELLY_TOP = 156;
const BELLY_ROW = 10;
const BELLY_HALF_WIDTHS = [52, 68, 79, 87, 93, 97, 100, 101, 101, 100, 97, 93, 87, 78, 64];

/** Tall tapered ears, drawn at two centres either side of the head. */
const EAR_TOP = 20;
const EAR_ROW = 8;
const EAR_HALF_WIDTHS = [6, 10, 13, 15, 16, 17, 17, 17];
const EAR_CENTERS = [96, 184];

interface RowSpec {
  top: number;
  rowHeight: number;
  halfWidths: readonly number[];
  centerX: number;
}

/**
 * Emits one <rect> per row. `grow` inflates every row, which is how the dark
 * outline is produced: the same silhouette drawn slightly larger underneath.
 */
function rows(spec: RowSpec, fill: string, grow = 0): string {
  return spec.halfWidths
    .map((halfWidth, index) => {
      const width = (halfWidth + grow) * 2;
      const x = spec.centerX - halfWidth - grow;
      const y = spec.top + index * spec.rowHeight - (index === 0 ? grow : 0);
      const height = spec.rowHeight + (index === 0 ? grow : 0);
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" />`;
    })
    .join('');
}

const bodySpec: RowSpec = {
  top: BODY_TOP,
  rowHeight: BODY_ROW,
  halfWidths: BODY_HALF_WIDTHS,
  centerX: CENTER_X,
};

const bellySpec: RowSpec = {
  top: BELLY_TOP,
  rowHeight: BELLY_ROW,
  halfWidths: BELLY_HALF_WIDTHS,
  centerX: CENTER_X,
};

function earSpec(centerX: number): RowSpec {
  return { top: EAR_TOP, rowHeight: EAR_ROW, halfWidths: EAR_HALF_WIDTHS, centerX };
}

/** A darker strip down the right edge, so the body reads as rounded. */
function bodyShading(): string {
  return BODY_HALF_WIDTHS.map((halfWidth, index) => {
    const y = BODY_TOP + index * BODY_ROW;
    const width = Math.max(5, Math.round(halfWidth * 0.14));
    const x = CENTER_X + halfWidth - width;
    return `<rect x="${x}" y="${y}" width="${width}" height="${BODY_ROW}" fill="${PALETTE.bodyShadow}" />`;
  }).join('');
}

/** One small chevron marking, the belly's signature detail. */
function chevron(x: number, y: number): string {
  return (
    `<rect x="${x + 3}" y="${y}" width="4" height="3" fill="${PALETTE.marking}" />` +
    `<rect x="${x}" y="${y + 3}" width="3" height="3" fill="${PALETTE.marking}" />` +
    `<rect x="${x + 7}" y="${y + 3}" width="3" height="3" fill="${PALETTE.marking}" />`
  );
}

/**
 * Chevrons are placed where the dial does not cover the belly: a row across
 * the top, and columns down each side.
 */
function bellyMarkings(): string {
  const marks: string[] = [];

  for (const x of [100, 126, 152]) marks.push(chevron(x, 162));
  for (const y of [188, 214, 240, 266]) {
    marks.push(chevron(58, y));
    marks.push(chevron(212, y));
  }

  return marks.join('');
}

/** Small white eye with a dark pupil, plus the lid used for blinking. */
function eye(x: number, id: string): string {
  return `
    <g>
      <rect x="${x - 2}" y="96" width="18" height="22" fill="${PALETTE.outline}" />
      <rect x="${x}" y="98" width="14" height="18" fill="${PALETTE.eyeWhite}" />
      <rect x="${x + 4}" y="104" width="6" height="7" fill="${PALETTE.dark}" />
      <rect id="${id}" class="eyelid" x="${x}" y="98" width="14" height="18" fill="${PALETTE.body}" />
    </g>`;
}

/** Stepped whiskers either side of the head. */
/** Whiskers spring from the head's edge and reach out past the silhouette. */
function whiskers(): string {
  const out: string[] = [];
  const bars = [
    [118, 40],
    [110, 36],
    [102, 30],
  ];

  for (const [y, length] of bars) {
    out.push(`<rect x="${56 - length}" y="${y}" width="${length}" height="3" fill="${PALETTE.outline}" />`);
    out.push(`<rect x="224" y="${y}" width="${length}" height="3" fill="${PALETTE.outline}" />`);
  }

  return out.join('');
}

/** Two stubby feet peeking out below the base. */
function feet(): string {
  const out: string[] = [];
  for (const x of [86, 158]) {
    out.push(
      `<rect x="${x - 3}" y="305" width="42" height="24" fill="${PALETTE.outline}" />`,
      `<rect x="${x}" y="308" width="36" height="18" fill="${PALETTE.bodyShadow}" />`,
    );
  }
  return out.join('');
}

/**
 * The complete character. `#totoro-body` is the group the breathing animation
 * translates, so the whole creature moves as one piece.
 */
export function buildTotoroMarkup(): string {
  return `
<svg
  id="totoro"
  width="280"
  height="340"
  viewBox="0 0 280 340"
  xmlns="http://www.w3.org/2000/svg"
  shape-rendering="crispEdges"
>
  <g id="totoro-body">
    ${feet()}

    ${EAR_CENTERS.map((cx) => rows(earSpec(cx), PALETTE.outline, 3)).join('')}
    ${EAR_CENTERS.map((cx) => rows(earSpec(cx), PALETTE.body)).join('')}
    <rect x="${EAR_CENTERS[0]! + 10}" y="26" width="3" height="56" fill="${PALETTE.bodyShadow}" />
    <rect x="${EAR_CENTERS[1]! + 10}" y="26" width="3" height="56" fill="${PALETTE.bodyShadow}" />

    ${rows(bodySpec, PALETTE.outline, 3)}
    ${rows(bodySpec, PALETTE.body)}
    ${bodyShading()}

    ${whiskers()}
    ${eye(97, 'eyelid-left')}
    ${eye(163, 'eyelid-right')}
    <rect x="122" y="110" width="36" height="5" fill="${PALETTE.dark}" />
    <rect x="137" y="128" width="6" height="6" fill="${PALETTE.dark}" />

    ${rows(bellySpec, PALETTE.outline, 2)}
    ${rows(bellySpec, PALETTE.belly)}
    ${bellyMarkings()}

    ${buildDialMarkup()}
  </g>
</svg>`;
}
