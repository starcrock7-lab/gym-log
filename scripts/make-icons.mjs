// Draws the app icons. Run with `node personal-gym/scripts/make-icons.mjs`.
//
// A hand-rolled PNG writer rather than a dependency: the icon is four
// rectangles on a background, and zlib is already in Node.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour with alpha
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

function draw(size, { padding = 0 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  // Matches the app palette: --off ground, --card panel, blue --accent.
  const bg = hex('#081124');
  const panel = hex('#0f1d3d');
  const accent = hex('#1e76f0');

  // Everything the eye should read sits inside `inset`, which leaves the
  // maskable safe zone clear when a launcher crops the corners.
  const inset = size * padding;
  const span = size - inset * 2;
  const radius = span * 0.22;

  const put = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
  };

  const inRoundedRect = (x, y, left, top, right, bottom, r) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    const cx = Math.min(Math.max(x, left + r), right - r);
    const cy = Math.min(Math.max(y, top + r), bottom - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2 || (x >= left + r && x <= right - r) || (y >= top + r && y <= bottom - r);
  };

  const bar = (x, y, x0, y0, x1, y1, r) =>
    inRoundedRect(x, y, inset + span * x0, inset + span * y0, inset + span * x1, inset + span * y1, span * r);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      put(x, y, bg);
      if (inRoundedRect(x, y, inset, inset, size - inset, size - inset, radius)) put(x, y, panel);

      const onDumbbell =
        bar(x, y, 0.30, 0.455, 0.70, 0.545, 0.02) ||   // handle
        bar(x, y, 0.22, 0.33, 0.32, 0.67, 0.035) ||    // inner plates
        bar(x, y, 0.68, 0.33, 0.78, 0.67, 0.035) ||
        bar(x, y, 0.13, 0.395, 0.21, 0.605, 0.03) ||   // outer plates
        bar(x, y, 0.79, 0.395, 0.87, 0.605, 0.03);

      if (onDumbbell) put(x, y, accent);
    }
  }
  return pixels;
}

mkdirSync(OUT, { recursive: true });

for (const [name, size, options] of [
  ['icon-180.png', 180, { padding: 0 }],
  ['icon-192.png', 192, { padding: 0 }],
  ['icon-512.png', 512, { padding: 0 }],
  ['icon-maskable-512.png', 512, { padding: 0.1 }],
]) {
  writeFileSync(join(OUT, name), png(size, size, draw(size, options)));
  console.log(`wrote icons/${name}`);
}
