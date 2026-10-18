// Cuts generated hair contact sheets (a grid of mannequin heads on a plain light background) into one square tile per hairstyle.
//   node scripts/slice-hair-sheets.mjs <input-dir> [--out public/oddlings/hair] [--only sheet1.jpg] [--manifest outfit-tiles.manifest.json]
// The manifest (scripts/hair-tiles.manifest.json) names each source image, its grid (rows of head counts) and the styles in reading order.
// An entry may set "mirror" to flip its pictures left to right, and "window" (default 0.14) to narrow how far a cut may move from the even split, for a sheet whose figures have little contrast with the background.
// A sheet that does not hold exactly the heads the manifest expects is refused, so a bad generation never ships a mislabelled tile.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { hairTileSlug } from '../app/veyrnox/_lib/oddlingHairTiles.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILE = 256;
const FOREGROUND_DELTA = 34; // luminance distance from the background that counts as part of a head, hair or shelf; soft floor shadows stay below it
const MIN_INK = 0.012; // a cell holding less foreground than this share of its area is empty

/** Foreground mask of an image: 1 where the pixel differs from the background (the median of the border) by more than FOREGROUND_DELTA. */
export function foregroundMask({ data, width, height }) {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  const border = [];
  for (let x = 0; x < width; x += 3) { border.push(lum[x], lum[(height - 1) * width + x]); }
  for (let y = 0; y < height; y += 3) { border.push(lum[y * width], lum[y * width + width - 1]); }
  border.sort((a, b) => a - b);
  const background = border[border.length >> 1];
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.abs(lum[i] - background) > FOREGROUND_DELTA ? 1 : 0;
  return { mask, background };
}

const smooth = (profile, radius) => profile.map((_, i) => {
  let sum = 0, n = 0;
  for (let j = Math.max(0, i - radius); j <= Math.min(profile.length - 1, i + radius); j++) { sum += profile[j]; n++; }
  return sum / n;
});

/** Positions of the (parts - 1) quietest valleys of a profile, each searched near its even split (within `window` of the length). */
export function valleys(profile, parts, window = 0.14) {
  const flat = smooth(profile, 3), peak = Math.max(1, ...flat), out = [];
  for (let k = 1; k < parts; k++) {
    const centre = Math.round((flat.length * k) / parts), reach = Math.max(1, Math.round(flat.length * window));
    // Empty margins are as quiet as a real gap, so a small pull towards the even split keeps the cut between two heads.
    const score = (i) => flat[i] / peak + (0.05 * Math.abs(i - centre)) / reach;
    let best = centre;
    for (let i = Math.max(1, centre - reach); i <= Math.min(flat.length - 2, centre + reach); i++) if (score(i) < score(best) - 1e-9) best = i;
    out.push(best);
  }
  return out;
}

function bounds(mask, width, x0, y0, x1, y1) {
  let minX = x1, minY = y1, maxX = x0, maxY = y0, ink = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mask[y * width + x]) { ink++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { ink, minX, minY, maxX, maxY };
}

/** Split an image into the cells of `rows` (for example [4, 4] or [3, 3]); returns one { x, y, size, rect } per cell, reading order: a square around the head and the cell it was found in. */
export function cellsOf(image, rows, window = 0.14) {
  const { width, height } = image, { mask } = foregroundMask(image);
  const rowProfile = Array.from({ length: height }, (_, y) => { let n = 0; for (let x = 0; x < width; x++) n += mask[y * width + x]; return n; });
  const rowCuts = [0, ...valleys(rowProfile, rows.length, window), height];
  const cells = [];
  rows.forEach((count, r) => {
    const y0 = rowCuts[r], y1 = rowCuts[r + 1];
    const colProfile = Array.from({ length: width }, (_, x) => { let n = 0; for (let y = y0; y < y1; y++) n += mask[y * width + x]; return n; });
    const colCuts = [0, ...valleys(colProfile, count, window), width];
    for (let c = 0; c < count; c++) {
      const box = bounds(mask, width, colCuts[c], y0, colCuts[c + 1], y1);
      cells.push({ box, rect: { x0: colCuts[c], y0, x1: colCuts[c + 1], y1 }, ink: box.ink / ((colCuts[c + 1] - colCuts[c]) * (y1 - y0)) });
    }
  });
  return cells.map(({ box, rect, ink }) => {
    if (ink < MIN_INK) return null;
    const w = box.maxX - box.minX + 1, h = box.maxY - box.minY + 1, size = Math.ceil(Math.max(w, h) * 1.1);
    return { x: Math.round(box.minX + w / 2 - size / 2), y: Math.round(box.minY + h / 2 - size / 2), size, rect };
  });
}

async function sliceOne(entry, inputDir, outDir) {
  const source = await readFile(path.join(inputDir, entry.file));
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { data, width: info.width, height: info.height };
  const rows = entry.rows || [1];
  const expected = rows.reduce((a, b) => a + b, 0);
  if (entry.styles.length !== expected) throw new Error(`${entry.file}: manifest lists ${entry.styles.length} styles for a ${expected}-cell grid`);
  const cells = cellsOf(image, rows, entry.window);
  const empty = cells.map((cell, i) => (cell ? null : i)).filter((i) => i !== null);
  if (empty.length) throw new Error(`${entry.file}: ${empty.length} empty cell(s) at ${empty.join(', ')}; the sheet does not hold ${expected} heads`);
  const { background } = foregroundMask(image);
  const fill = { r: Math.round(background), g: Math.round(background), b: Math.round(background) };
  const written = [];
  for (let i = 0; i < cells.length; i++) {
    if (!entry.styles[i]) continue;
    const { x, y, size, rect } = cells[i], pad = Math.max(0, -x, -y, x + size - info.width, y + size - info.height);
    // A square around a wide head reaches into its neighbours, so everything outside the head's own cell is painted over with the background.
    const own = Buffer.from(data);
    for (let row = 0; row < info.height; row++) for (let col = 0; col < info.width; col++) {
      if (col >= rect.x0 && col < rect.x1 && row >= rect.y0 && row < rect.y1) continue;
      const at = (row * info.width + col) * 3;
      own[at] = fill.r; own[at + 1] = fill.g; own[at + 2] = fill.b;
    }
    // sharp runs extract before extend whatever the call order, so pad into a buffer first and cut the square from that.
    const padded = await sharp(own, { raw: { width: info.width, height: info.height, channels: 3 } }).extend({ top: pad, bottom: pad, left: pad, right: pad, background: fill }).png().toBuffer();
    const cut = sharp(padded).extract({ left: x + pad, top: y + pad, width: size, height: size }).resize(TILE, TILE);
    // "mirror" writes the picture flipped left to right: a right arm or leg is the left one mirrored.
    const tile = await (entry.mirror ? cut.flop() : cut).webp({ quality: 82 }).toBuffer();
    const name = path.join(outDir, `${hairTileSlug(entry.styles[i])}.webp`);
    await writeFile(name, tile);
    written.push(name);
  }
  return written;
}

async function main() {
  const args = process.argv.slice(2);
  const inputDir = args.find((arg) => !arg.startsWith('--'));
  const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  if (!inputDir) { console.error('usage: node scripts/slice-hair-sheets.mjs <input-dir> [--out dir] [--only file]'); process.exit(2); }
  const outDir = path.resolve(flag('--out', path.join(HERE, '..', 'public', 'oddlings', 'hair')));
  const only = flag('--only', '');
  const manifest = JSON.parse(await readFile(path.join(HERE, flag('--manifest', 'hair-tiles.manifest.json')), 'utf8'));
  await mkdir(outDir, { recursive: true });
  let total = 0, failed = 0;
  for (const entry of manifest.sources.filter((source) => !only || source.file === only)) {
    try {
      const written = await sliceOne(entry, path.resolve(inputDir), outDir);
      total += written.length;
      console.log(`${entry.file}: ${written.length} tiles`);
    } catch (error) { failed++; console.error(error.message); }
  }
  console.log(`${total} tiles written to ${outDir}${failed ? `; ${failed} source(s) refused` : ''}`);
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
