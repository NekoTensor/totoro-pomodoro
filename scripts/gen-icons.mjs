// Generates the app and tray icons as PNGs from the same pixel-art palette as
// the character, so no binary art assets need to be checked in by hand.
//
// Writes a minimal 8-bit RGBA PNG directly (IHDR/IDAT/IEND + zlib deflate),
// which avoids pulling in an image library for two small files.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = join(here, '..', 'build');

// Must stay in step with src/renderer/components/palette.ts.
const COLORS = {
  transparent: [0, 0, 0, 0],
  body: [0x7c, 0x7c, 0x64, 255],
  outline: [0x2e, 0x2e, 0x26, 255],
  dark: [0x1c, 0x1c, 0x18, 255],
  belly: [0xeb, 0xeb, 0xb4, 255],
  green: [0x8b, 0x9a, 0x68, 255],
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, pixelAt) {
  // Each scanline is prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Totoro reduced to a 16x16 grid, then scaled up by whole pixels so every
 * icon size stays perfectly crisp.
 */
const GRID = [
  '................',
  '...#........#...',
  '..#o#......#o#..',
  '..#o#......#o#..',
  '.##ooo####ooo##.',
  '.#oooooooooooo#.',
  '#oooooooooooooo#',
  '#oo##ooooo##oo#.',
  '#oo#w#ooo#w#oo#.',
  '#ooo#ooooo#ooo#.',
  '#oobbbbbbbbboo#.',
  '#obbbgggggbbbo#.',
  '#obbbgggggbbbo#.',
  '.#bbbbgggbbbbb#.',
  '.##bbbbbbbbbb##.',
  '..############..',
];

const LEGEND = {
  '.': COLORS.transparent,
  '#': COLORS.outline,
  o: COLORS.body,
  b: COLORS.belly,
  g: COLORS.green,
  w: COLORS.dark,
};

function pixelFor(scale) {
  return (x, y) => {
    const gx = Math.floor(x / scale);
    const gy = Math.floor(y / scale);
    const row = GRID[Math.min(gy, GRID.length - 1)];
    const char = row[Math.min(gx, row.length - 1)] ?? '.';
    return LEGEND[char] ?? COLORS.transparent;
  };
}

function write(name, size) {
  const scale = size / 16;
  writeFileSync(join(buildDir, name), encodePng(size, pixelFor(scale)));
  console.log(`wrote build/${name} (${size}x${size})`);
}

mkdirSync(buildDir, { recursive: true });
write('icon.png', 512);
write('tray.png', 32);
