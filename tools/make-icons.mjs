// Draws the app icon, an amber Z on the dark tile, as the PNG files the web
// app manifest needs: icons/icon-192.png and icons/icon-512.png (rounded
// tile on a transparent background) and icons/maskable-512.png (the tile
// fills the whole square, the Z kept inside the safe area, for launchers
// that cut their own shape). No image library: the shapes are simple
// enough to rasterise here, and the output is the same on every machine.
//
//   node tools/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const TILE = [0x0b, 0x0e, 0x13];   // --bg
const Z = [0xf5, 0xb8, 0x3d];      // --accent
const SS = 4;                      // subsamples per pixel edge, for smooth edges

// Where the Z's strokes are, in a unit square; `scale` shrinks it about
// the centre. Two horizontal bars and a diagonal band joining them.
function makeZ(scale) {
  const w = 0.52 * scale;
  const h = 0.62 * scale;
  const t = 0.19 * scale;          // bar thickness
  const left = 0.5 - w / 2;
  const right = 0.5 + w / 2;
  const top = 0.5 - h / 2;
  const bottom = 0.5 + h / 2;
  const half = t * 0.68;           // the diagonal's horizontal half-width
  return (x, y) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    if (y <= top + t || y >= bottom - t) return true;
    const centre = right - ((y - top) / h) * w;
    return Math.abs(x - centre) <= half;
  };
}

function render(size, { rounded, scale }) {
  const inZ = makeZ(scale);
  const r = rounded ? 12 / 64 : 0;  // corner radius, as the SVG icon has
  const inTile = (x, y) => {
    if (!rounded) return true;
    const cx = x < r ? r : x > 1 - r ? 1 - r : x;
    const cy = y < r ? r : y > 1 - r ? 1 - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let a = 0; const rgb = [0, 0, 0];
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = (i + (si + 0.5) / SS) / size;
          const y = (j + (sj + 0.5) / SS) / size;
          if (!inTile(x, y)) continue;
          const c = inZ(x, y) ? Z : TILE;
          a++; rgb[0] += c[0]; rgb[1] += c[1]; rgb[2] += c[2];
        }
      }
      const o = (j * size + i) * 4;
      if (a) { px[o] = rgb[0] / a; px[o + 1] = rgb[1] / a; px[o + 2] = rgb[2] / a; }
      px[o + 3] = (a / (SS * SS)) * 255;
    }
  }
  return png(size, px);
}

// ---- PNG writing ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) {
    rows[j * (size * 4 + 1)] = 0;   // filter: none
    rows.set(px.subarray(j * size * 4, (j + 1) * size * 4), j * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
const out = {
  'icons/icon-192.png': render(192, { rounded: true, scale: 1 }),
  'icons/icon-512.png': render(512, { rounded: true, scale: 1 }),
  'icons/maskable-512.png': render(512, { rounded: false, scale: 0.78 }),
};
for (const [name, buf] of Object.entries(out)) {
  writeFileSync(name, buf);
  console.log(`${name}: ${buf.length} bytes`);
}
