/**
 * Generates the app icons in public/icons from the game's own soldier sprite.
 *
 *   npm run make-icons
 *
 * Writes plain PNGs with Node's zlib, so no image libraries are needed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PALETTE, resolveSpriteIndex } from '../src/formats/palette.ts';
import { parsePix, pixFrame } from '../src/formats/pix.ts';

const root = resolve(import.meta.dirname, '..');
const assets = join(root, 'public/assets');
const outDir = join(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const index = JSON.parse(readFileSync(join(assets, 'sprites.json'), 'utf8')) as Record<string, [number, number]>;
const bin = readFileSync(join(assets, 'sprites.bin'));
const [offset, length] = index.footman;
const pix = parsePix(new Uint8Array(bin.subarray(offset, offset + length)));
const sprite = pixFrame(pix, 0); // facing the viewer

const BACKGROUND = [20, 17, 15];
const GOLD = [214, 170, 92];

/**
 * Draws the soldier centred and pixel-scaled on the dark background. `fill` is the share of
 * the icon the sprite may take: maskable icons keep to the inner safe zone.
 */
function render(size: number, fill: number, rounded: boolean): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.18 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = !rounded || insideRoundedSquare(x + 0.5, y + 0.5, size, radius);
      if (!inside) continue;
      // A soft gold glow behind the figure.
      const dx = (x - size / 2) / size;
      const dy = (y - size * 0.55) / size;
      const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 2.6) * 0.35;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BACKGROUND[c] + (GOLD[c] - BACKGROUND[c]) * glow);
      rgba[i + 3] = 255;
    }
  }
  const scale = Math.floor((size * fill) / Math.max(pix.width, pix.height));
  const ox = Math.floor((size - pix.width * scale) / 2);
  const oy = Math.floor((size - pix.height * scale) / 2);
  for (let sy = 0; sy < pix.height; sy++) {
    for (let sx = 0; sx < pix.width; sx++) {
      const index = sprite[sy * pix.width + sx];
      if (!index) continue;
      const [r, g, b] = PALETTE[resolveSpriteIndex(index, 0)];
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = ((oy + sy * scale + y) * size + ox + sx * scale + x) * 4;
          rgba.set([r, g, b, 255], i);
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

function insideRoundedSquare(x: number, y: number, size: number, r: number): boolean {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// --- Minimal PNG encoder ----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS: [file: string, size: number, fill: number, rounded: boolean][] = [
  ['icon-192.png', 192, 0.7, true],
  ['icon-512.png', 512, 0.7, true],
  ['maskable-512.png', 512, 0.5, false], // content stays inside the 80% safe zone
  ['apple-touch-icon.png', 180, 0.62, false], // iOS rounds the corners itself
  ['favicon-32.png', 32, 0.9, false],
];

for (const [file, size, fill, rounded] of ICONS) {
  writeFileSync(join(outDir, file), render(size, fill, rounded));
  console.log(`icons/${file}`);
}
