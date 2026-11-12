#!/usr/bin/env node

/**
 * Import a pinned, genre-balanced set of CC BY instrumentals from ccMixter.
 *
 * The ccMixter Query API is the licence receipt and authorized download source.
 * We do not scrape player streams or reuse creator avatars. Each track receives
 * original generated artwork owned by Veyrnox.
 *
 * Usage:
 *   node scripts/import-ccmixter-genre-catalog.mjs --execute
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rows = [
  ['Hip-hop', 16626], ['Hip-hop', 37792], ['Hip-hop', 19367],
  ['Rock', 32423], ['Rock', 43098], ['Rock', 25202],
  ['Jazz', 64427], ['Jazz', 29923], ['Jazz', 35050],
  ['Electronic', 14073], ['Electronic', 43002], ['Electronic', 43975],
  ['Funk', 33345], ['Funk', 64416], ['Funk', 41411],
  ['Ambient', 14476], ['Ambient', 33304], ['Ambient', 60674],
  ['Classical', 2905], ['Classical', 24456], ['Classical', 25027],
  ['Acoustic', 33580], ['Acoustic', 27007], ['Acoustic', 30638],
  ['Soul', 14246], ['Soul', 13112], ['Soul', 67394],
  ['Indie', 31783], ['Indie', 37204], ['Indie', 59691],
  ['Blues', 35724], ['Blues', 38167], ['Blues', 60675],
  ['Reggae', 43815], ['Reggae', 46263], ['Reggae', 56346],
];

const apiRoot = 'https://ccmixter.org/api/query?f=json&dataview=default&ids=';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = join(repoRoot, 'public', 'music-licensed');
const workDir = join(tmpdir(), 'veyrnox-ccmixter-genre-import');
const catalogPath = join(repoRoot, 'lib', 'licensedMusicCatalog.js');
const docsPath = join(repoRoot, 'docs', 'architecture', 'licensed-music-catalog.md');
const execute = process.argv.includes('--execute');

if (!execute) {
  console.log(`Ready to import ${rows.length} pinned CC BY instrumentals from ccMixter. Re-run with --execute.`);
  process.exit(0);
}

mkdirSync(assetDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result;
}

function fetchJson(url) {
  const result = spawnSync('curl', [
    '-fsSL', '--retry', '5', '--retry-delay', '2', '--retry-all-errors',
    '--connect-timeout', '20', '--max-time', '120', url,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Metadata request failed: ${url}`);
  return JSON.parse(result.stdout);
}

function download(url, destination, referrer) {
  run('curl', [
    '-fsSL', '--retry', '5', '--retry-delay', '2', '--retry-all-errors',
    '--connect-timeout', '20', '--max-time', '600',
    '-e', referrer,
    '-o', destination, url,
  ]);
}

function slug(value) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 54);
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function artworkSvg(track, digest) {
  const hue = Number.parseInt(digest.slice(0, 4), 16) % 360;
  const hue2 = (hue + 72 + (Number.parseInt(digest.slice(4, 6), 16) % 90)) % 360;
  const initials = track.title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-labelledby="title desc">
  <title id="title">${xml(track.title)} artwork</title>
  <desc id="desc">Original abstract Veyrnox artwork for ${xml(track.category)}</desc>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 82% 52%)"/><stop offset="1" stop-color="hsl(${hue2} 78% 28%)"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="32"/></filter></defs>
  <rect width="600" height="600" rx="72" fill="#09090b"/><circle cx="160" cy="150" r="210" fill="url(#g)" opacity=".9" filter="url(#b)"/><circle cx="510" cy="470" r="190" fill="hsl(${hue2} 90% 55%)" opacity=".42" filter="url(#b)"/>
  <path d="M72 390c78-120 147 105 229-31s151 79 227-45" fill="none" stroke="rgba(255,255,255,.72)" stroke-width="18" stroke-linecap="round"/>
  <text x="72" y="118" fill="white" font-family="system-ui,sans-serif" font-size="30" font-weight="700" letter-spacing="5">${xml(track.category.toUpperCase())}</text><text x="72" y="530" fill="white" font-family="system-ui,sans-serif" font-size="112" font-weight="900">${xml(initials)}</text>
</svg>`;
}

const imported = [];
for (const [category, uploadId] of rows) {
  const records = fetchJson(`${apiRoot}${uploadId}`);
  if (records.length !== 1) throw new Error(`Expected one ccMixter record for ${uploadId}`);
  const record = records[0];
  const tags = String(record.upload_tags || '');
  if (!tags.split(',').includes('instrumental')) throw new Error(`${uploadId} is no longer tagged instrumental`);
  const licenseUrl = String(record.license_url || '').replace(/^http:/, 'https:');
  const licenseVersion = licenseUrl.match(/\/by\/(2\.5|3\.0|4\.0)\//)?.[1];
  if (!licenseVersion || /noncommercial|no.?deriv/i.test(String(record.license_name))) throw new Error(`${uploadId} no longer has a compatible CC BY licence`);
  const source = record.files?.find((file) => file.file_format_info?.['media-type'] === 'audio' && file.file_name?.toLowerCase().endsWith('.mp3'));
  if (!source?.download_url) throw new Error(`${uploadId} has no downloadable MP3`);

  const title = String(record.upload_name).trim();
  const creator = String(record.user_real_name || record.user_name).trim();
  const featured = String(record.upload_extra?.featuring || '').trim();
  const id = `ccmixter-${uploadId}-${slug(title)}`;
  const file = `${id}.mp3`;
  const artwork = `${id}.svg`;
  const audioOutput = join(assetDir, file);
  const artworkOutput = join(assetDir, artwork);
  const sourceAudio = join(workDir, `${uploadId}.source.mp3`);

  console.log(`[${imported.length + 1}/${rows.length}] ${category}: ${title}`);
  if (!existsSync(audioOutput)) {
    download(source.download_url, sourceAudio, record.file_page_url);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourceAudio, '-map_metadata', '-1', '-vn', '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', audioOutput]);
    rmSync(sourceAudio);
  }

  const audioBytes = readFileSync(audioOutput);
  const sha256 = createHash('sha256').update(audioBytes).digest('hex');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioOutput], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${file}`);
  const durationSec = Math.round(Number(probe.stdout.trim()));
  if (!Number.isFinite(durationSec) || durationSec < 30) throw new Error(`Invalid duration for ${title}`);

  const track = {
    id, title, creator, category, durationSec, file, artwork, bytes: audioBytes.length, sha256,
    sourceProvider: 'ccMixter', sourceUrl: record.file_page_url, downloadSourceUrl: source.download_url,
    license: `CC BY ${licenseVersion}`, licenseUrl,
    attribution: `Music “${title}” by ${creator}${featured ? ` featuring ${featured}` : ''} — available at ccMixter.org — CC BY ${licenseVersion}`,
  };
  writeFileSync(artworkOutput, artworkSvg(track, sha256));
  imported.push(track);
}

const begin = '  // BEGIN GENERATED CCMIXTER GENRE TRACKS';
const end = '  // END GENERATED CCMIXTER GENRE TRACKS';
const entryText = imported.map((track) => `  Object.freeze(${JSON.stringify(track, null, 2).replace(/^/gm, '  ')}),`).join('\n');
const catalog = readFileSync(catalogPath, 'utf8');
if (!catalog.includes(begin) || !catalog.includes(end)) throw new Error('ccMixter catalogue generation markers are missing');
writeFileSync(catalogPath, catalog.replace(new RegExp(`${begin}[\\s\\S]*?${end}`), `${begin}\n${entryText}\n${end}`));

const docBegin = '<!-- BEGIN GENERATED CCMIXTER GENRE TRACKS -->';
const docEnd = '<!-- END GENERATED CCMIXTER GENRE TRACKS -->';
const docRows = imported.map((track) => `| ${track.category} | ${track.title.replaceAll('|', '\\|')} | ${track.creator.replaceAll('|', '\\|')} | ${track.sourceUrl} | ${track.downloadSourceUrl} | ${track.license} |`).join('\n');
const docs = readFileSync(docsPath, 'utf8');
if (!docs.includes(docBegin) || !docs.includes(docEnd)) throw new Error('ccMixter documentation generation markers are missing');
writeFileSync(docsPath, docs.replace(new RegExp(`${docBegin}[\\s\\S]*?${docEnd}`), `${docBegin}\n${docRows}\n${docEnd}`));

rmSync(workDir, { recursive: true, force: true });
console.log(`Imported ${imported.length} genre tracks; catalogue total target is 87.`);
