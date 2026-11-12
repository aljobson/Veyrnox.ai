import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MUSIC_DISCOVER_BEATS } from '../lib/musicDiscover.js';

const output = fileURLToPath(new URL('../public/music-discover/samples/', import.meta.url));

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function artwork(beat) {
  const seed = hash(beat.id);
  const x = 26 + (seed % 48);
  const y = 32 + ((seed >>> 5) % 58);
  const size = 42 + ((seed >>> 11) % 34);
  const initials = beat.title.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(beat.title)} artwork</title>
  <desc id="desc">Original geometric artwork for the ${escapeXml(beat.mood)} sample ${escapeXml(beat.title)}.</desc>
  <rect width="160" height="160" rx="28" fill="#111114"/>
  <circle cx="${x}" cy="${y}" r="${size}" fill="${beat.accent}" opacity=".34"/>
  <path d="M-12 ${118 - (seed % 20)} C28 ${68 + (seed % 24)},58 ${144 - (seed % 18)},94 ${92 + (seed % 28)} S142 ${56 + (seed % 34)},174 ${86 + (seed % 22)}" fill="none" stroke="${beat.accent}" stroke-width="10" stroke-linecap="round"/>
  <circle cx="122" cy="38" r="18" fill="#f4f4f5" opacity=".93"/>
  <text x="122" y="44" fill="#111114" font-family="Arial, sans-serif" font-size="14" font-weight="800" text-anchor="middle">${escapeXml(initials)}</text>
  <text x="18" y="137" fill="#f4f4f5" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1">${escapeXml(beat.mood.toUpperCase())}</text>
</svg>`;
}

await mkdir(output, { recursive: true });
await Promise.all(MUSIC_DISCOVER_BEATS.map((beat) => (
  writeFile(new URL(`../public${beat.artwork}`, import.meta.url), artwork(beat), 'utf8')
)));
console.log(`Generated ${MUSIC_DISCOVER_BEATS.length} compact sample artworks in ${output}`);
