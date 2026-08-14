// The colour palette, kept in its own module so both the character and the
// dial can read it without a circular import.
//
// Olive-grey body with a pale yellow belly, matching the classic pixel-art
// Totoro rather than the blue-grey scheme.

export const PALETTE = {
  body: '#7C7C64',
  bodyShadow: '#62624E',
  outline: '#2E2E26',
  dark: '#1C1C18',
  belly: '#EBEBB4',
  bellyShadow: '#D8D89A',
  /** Chevron markings on the belly. */
  marking: '#9A9A82',
  eyeWhite: '#FFFFFF',
  timerGreen: '#8B9A68',
  timerHighlight: '#B4C38A',
} as const;
