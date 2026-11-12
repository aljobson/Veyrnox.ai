#!/usr/bin/env node

/**
 * Rebuild the 45 Scott Buckley catalogue additions from creator-hosted files.
 *
 * SoundCloud is used only as the discovery/licence receipt. Audio and artwork
 * are downloaded from Scott Buckley's own CC BY 4.0 library.
 *
 * Usage:
 *   node scripts/import-authorized-music-catalog.mjs --execute
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rows = [
  ['pumpkin-polka', 'Pumpkin Polka', 'Whimsical', 'https://soundcloud.com/scottbuckley/pumpkin-polka-cc-by', '2026/08/PumpkinPolka.mp3', '2026/08/PumpkinPolka_Wide.jpg', 152],
  ['with-these-hands', 'With These Hands', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/with-these-hands-cc-by', '2026/06/WithTheseHands.mp3', '2026/06/WithTheseHands_Wide.jpg', 306],
  ['unraveling', 'Unraveling', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/unraveling-cc-by', '2026/05/Unraveling.mp3', '2026/05/Unraveling-Wide.jpg', 444],
  ['convergence', 'Convergence', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/convergence-cc-by', '2026/04/Convergence.mp3', '2026/04/Convergence-Wide.jpg', 220],
  ['phoenix-2026', 'Phoenix', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/phoenix-cc-by-1', '2026/03/Phoenix2026.mp3', '2026/03/Phoenix-Wide.jpg', 354],
  ['memories-of-stone', 'Memories Of Stone', 'Piano & reflective', 'https://soundcloud.com/scottbuckley/memories-of-stone-cc-by', '2026/02/MemoriesOfStone.mp3', '2026/02/MemoriesOfStone-Wide.jpg', 330],
  ['starfire', 'Starfire', 'Cinematic adventure', 'https://soundcloud.com/scottbuckley/starfire-cc-by', '2026/01/Starfire.mp3', '2026/01/Starfire-Wide.jpg', 341],
  ['wildflowers', 'Wildflowers', 'Uplifting', 'https://soundcloud.com/scottbuckley/wildflowers-cc-by', '2025/12/Wildflowers.mp3', '2025/12/Wildflowers-Wide.jpg', 322],
  ['origami', 'Origami', 'Jazz & acoustic', 'https://soundcloud.com/scottbuckley/origami-cc-by', '2025/10/Origami.mp3', '2025/10/Origami-wide.jpg', 189],
  ['penumbra', 'Penumbra', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/penumbra-cc-by', '2025/07/Penumbra.mp3', '2025/07/Penumbra-Wide-01.jpg', 450],
  ['eyes-in-the-void', 'Eyes In The Void', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/eyes-in-the-void-cc-by', '2025/06/EyesInTheVoid.mp3', '2025/06/EyesInTheVoid-Wide.jpg', 264],
  ['echoes-of-home', 'Echoes Of Home', 'Piano & reflective', 'https://soundcloud.com/scottbuckley/echoes-of-home-cc-by', '2025/05/EchoesOfHome.mp3', '2025/05/EchoesOfHome_Wide-01.jpg', 292],
  ['incredulity', 'Incredulity', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/incredulity-cc-by', '2025/04/Incredulity.mp3', '2025/04/Incredulity-Wide-01.jpg', 374],
  ['honour-among-thieves', 'Honour Among Thieves', 'Cinematic adventure', 'https://soundcloud.com/scottbuckley/honour-among-thieves', '2025/04/HonourAmongThieves.mp3', '2025/04/HonourAmong-Wide-01.jpg', 240],
  ['amberlight', 'Amberlight', 'Ambient & atmospheric', 'https://soundcloud.com/scottbuckley/amberlight-cc-by', '2025/03/Amberlight.mp3', '2025/03/Amberlight-Wide-01.jpg', 283],
  ['simulacra', 'Simulacra', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/simulacra-cc-by', '2025/03/Simulacra.mp3', '2025/03/Simulacra-Wide-01.jpg', 234],
  ['ride-the-wind', 'Ride The Wind', 'Uplifting', 'https://soundcloud.com/scottbuckley/ride-the-wind-cc-by', '2025/01/RideTheWind.mp3', '2025/01/RideTheWind-Wide-01.jpg', 270],
  ['meanwhile', 'Meanwhile', 'Ambient & atmospheric', 'https://soundcloud.com/scottbuckley/meanwhile-cc-by', '2025/01/Meanwhile.mp3', '2025/01/Meanwhile-Wide-01.jpg', 326],
  ['winter-waltz', 'Winter Waltz', 'Whimsical', 'https://soundcloud.com/scottbuckley/winter-waltz-cc-by', '2024/11/WinterWaltz.mp3', '2024/11/WinterWaltz-Wide-01.jpg', 200],
  ['into-the-wilds', 'Into The Wilds', 'Cinematic adventure', 'https://soundcloud.com/scottbuckley/into-the-wilds-cc-by', '2024/11/IntoTheWilds.mp3', '2024/11/IntoTheWilds-Wide-01.jpg', 247],
  ['incantation', 'Incantation', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/incantation-cc-by', '2024/09/Incantation.mp3', '2024/09/Incantation-Wide.jpg', 433],
  ['shoulders-of-giants', 'Shoulders Of Giants', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/shoulders-of-giants-cc-by', '2024/09/ShouldersOfGiants.mp3', '2024/09/ShouldersOfGiants-Wide-01.jpg', 443],
  ['uprising', 'Uprising', 'Action & hybrid', 'https://soundcloud.com/scottbuckley/uprising-cc-by', '2024/07/Uprising.mp3', '2024/07/Uprising-Wide-01.jpg', 206],
  ['at-the-end-of-all-things', 'At The End Of All Things', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/at-the-end-of-all-things-cc-by', '2024/06/AtTheEndOfAllThings.mp3', '2024/06/AtTheEnd-Wide.jpg', 317],
  ['hyperion', 'Hyperion', 'Action & hybrid', 'https://soundcloud.com/scottbuckley/hyperion-cc-by', '2024/06/Hyperion.mp3', '2024/06/Hyperion-wide-01.jpg', 252],
  ['echoes', 'Echoes', 'Ambient & atmospheric', 'https://soundcloud.com/scottbuckley/echoes-cc-by', '2024/05/Echoes.mp3', '2024/05/echoes_wide-01.jpg', 364],
  ['sentinel', 'Sentinel', 'Action & hybrid', 'https://soundcloud.com/scottbuckley/sentinel-cc-by', '2024/04/Sentinel.mp3', '2024/04/Sentinel-Wide-01.jpg', 203],
  ['life-in-motion', 'Life In Motion', 'Uplifting', 'https://soundcloud.com/scottbuckley/life-in-motion-cc-by', '2024/03/LifeInMotion.mp3', '2024/03/lifeInMotion_wide-01.jpg', 381],
  ['simplicity', 'Simplicity', 'Piano & reflective', 'https://soundcloud.com/scottbuckley/simplicity-cc-by', '2024/03/Simplicity.mp3', '2024/03/simplicityWide-01.jpg', 185],
  ['clear-skies', 'Clear Skies', 'Uplifting', 'https://soundcloud.com/scottbuckley/clear-skies-cc-by', '2024/02/ClearSkies.mp3', '2024/02/ClearSkies-Wide-01.jpg', 195],
  ['the-great-sea', 'The Great Sea', 'Cinematic adventure', 'https://soundcloud.com/scottbuckley/the-great-sea-cc-by', '2024/01/TheGreatSea.mp3', '2024/01/theGreatSea_wide-01.jpg', 282],
  ['ignis', 'Ignis', 'Action & hybrid', 'https://soundcloud.com/scottbuckley/ignis-cc-by', '2024/01/Ignis.mp3', '2024/01/Ignis-Wide-01.jpg', 192],
  ['cicadas', 'Cicadas', 'Ambient & atmospheric', 'https://soundcloud.com/scottbuckley/cicadas-cc-by', '2023/12/Cicadas.mp3', '2023/12/Cicadas-Wide-01.jpg', 393],
  ['shadows-and-dust', 'Shadows and Dust', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/shadows-and-dust-cc-by', '2023/11/ShadowsAndDust.mp3', '2023/11/shadowsWide-01.jpg', 408],
  ['rites-of-passage', 'Rites Of Passage', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/rites-of-passage-cc-by', '2023/11/RitesOfPassage.mp3', '2023/11/ritesOfPassage_wide-01.jpg', 336],
  ['phase-shift', 'Phase Shift', 'Action & hybrid', 'https://soundcloud.com/scottbuckley/phase-shift-cc-by', '2023/10/PhaseShift.mp3', '2023/10/PhaseShift-Wide-01.jpg', 363],
  ['rise-above', 'Rise Above', 'Uplifting', 'https://soundcloud.com/scottbuckley/rise-above-cc-by', '2023/09/RiseAbove.mp3', '2023/09/RiseAbove-Wide-01.jpg', 268],
  ['golden-hour', 'Golden Hour', 'Uplifting', 'https://soundcloud.com/scottbuckley/golden-hour-cc-by', '2023/02/GoldenHour.mp3', '2023/02/goldenHour_wide-01.jpg', 324],
  ['the-long-dark', 'The Long Dark', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/the-long-dark-cc-by', '2023/01/TheLongDark.mp3', '2023/01/theLongDark_wide-01.jpg', 440],
  ['call-to-adventure', 'Call To Adventure', 'Cinematic adventure', 'https://soundcloud.com/scottbuckley/call-to-adventure-cc-by', '2023/01/CallToAdventure.mp3', '2023/01/callToAdventure_wide.jpg', 260],
  ['legacy', 'Legacy', 'Epic orchestral', 'https://soundcloud.com/scottbuckley/legacy-cc-by', '2022/12/Legacy.mp3', '2022/12/Legacy-Wide-01.jpg', 390],
  ['first-snow', 'First Snow', 'Ambient & atmospheric', 'https://soundcloud.com/scottbuckley/first-snow-cc-by', '2022/12/FirstSnow.mp3', '2022/12/firstSnow-wide2.jpg', 213],
  ['a-kind-of-hope', 'A Kind Of Hope', 'Uplifting', 'https://soundcloud.com/scottbuckley/a-kind-of-hope-cc-by', '2022/10/AKindOfHope.mp3', '2022/10/AKindOfHope-Wide.jpg', 343],
  ['hour-of-the-witch', 'Hour Of The Witch', 'Dark & suspense', 'https://soundcloud.com/scottbuckley/hour-of-the-witch-cc-by', '2022/10/HourOfTheWitch.mp3', '2022/10/hourOfTheWitch_wide.jpg', 217],
  ['path-through-the-mountains', 'Path Through The Mountains', 'Cinematic adventure', 'https://soundcloud.com/scottbuckley/path-through-the-mountains-cc-by', '2022/10/PathThroughTheMountains.mp3', '2022/10/PathThroughTheMountains_wide.jpg', 321],
];

const libraryRoot = 'https://www.scottbuckley.com.au/library/';
const uploadsRoot = `${libraryRoot}wp-content/uploads/`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = join(repoRoot, 'public', 'music-licensed');
const workDir = join(tmpdir(), 'veyrnox-authorized-music-import');
const catalogPath = join(repoRoot, 'lib', 'licensedMusicCatalog.js');
const docsPath = join(repoRoot, 'docs', 'architecture', 'licensed-music-catalog.md');
const execute = process.argv.includes('--execute');

if (!execute) {
  console.log(`Ready to import ${rows.length} creator-authorized tracks. Re-run with --execute.`);
  process.exit(0);
}

mkdirSync(assetDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

function download(url, destination) {
  run('curl', [
    '-fsSL', '--retry', '5', '--retry-delay', '2', '--retry-all-errors',
    '--connect-timeout', '20', '--max-time', '600',
    '-A', 'Veyrnox authorized catalogue importer/1.0',
    '-o', destination, url,
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

const imported = [];
for (const [slug, title, category, sourceUrl, audioPath, artworkPath, expectedDurationSec] of rows) {
  const id = `scott-buckley-${slug}`;
  const file = `${id}.mp3`;
  const artwork = `${id}.jpg`;
  const audioOutput = join(assetDir, file);
  const artworkOutput = join(assetDir, artwork);
  const sourceAudio = join(workDir, `${slug}.source.mp3`);
  const sourceArtwork = join(workDir, `${slug}.source-image`);

  console.log(`[${imported.length + 1}/${rows.length}] ${title}`);
  if (!existsSync(audioOutput)) {
    download(`${uploadsRoot}${audioPath}`, sourceAudio);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourceAudio, '-map_metadata', '-1', '-vn', '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', audioOutput]);
    rmSync(sourceAudio);
  }
  if (!existsSync(artworkOutput)) {
    download(`${uploadsRoot}${artworkPath}`, sourceArtwork);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourceArtwork, '-vf', 'scale=min(1000\\,iw):-2', '-frames:v', '1', '-q:v', '4', artworkOutput]);
    rmSync(sourceArtwork);
  }

  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioOutput], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${file}`);
  const durationSec = Math.round(Number(probe.stdout.trim()));
  if (Math.abs(durationSec - expectedDurationSec) > 2) throw new Error(`Duration mismatch for ${title}: ${durationSec}s vs ${expectedDurationSec}s`);
  const bytes = statSync(audioOutput).size;
  const sha256 = createHash('sha256').update(readFileSync(audioOutput)).digest('hex');
  imported.push({
    id, title, creator: 'Scott Buckley', category, durationSec, file, artwork, bytes, sha256,
    sourceUrl, downloadSourceUrl: `${libraryRoot}${slug}/`, license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: `'${title}' by Scott Buckley — released under CC BY 4.0 — www.scottbuckley.com.au`,
  });
}

const begin = '  // BEGIN GENERATED AUTHORIZED SCOTT BUCKLEY TRACKS';
const end = '  // END GENERATED AUTHORIZED SCOTT BUCKLEY TRACKS';
const entryText = imported.map((track) => `  Object.freeze(${JSON.stringify(track, null, 2).replace(/^/gm, '  ')}),`).join('\n');
const catalog = readFileSync(catalogPath, 'utf8');
const replacement = `${begin}\n${entryText}\n${end}`;
if (!catalog.includes(begin) || !catalog.includes(end)) throw new Error('Catalogue generation markers are missing');
writeFileSync(catalogPath, catalog.replace(new RegExp(`${begin}[\\s\\S]*?${end}`), replacement));

const docBegin = '<!-- BEGIN GENERATED AUTHORIZED TRACKS -->';
const docEnd = '<!-- END GENERATED AUTHORIZED TRACKS -->';
const docRows = imported.map((track) => `| ${track.category} | ${track.title} | ${track.creator} | ${track.sourceUrl} | ${track.downloadSourceUrl} | ${track.license} |`).join('\n');
const docs = readFileSync(docsPath, 'utf8');
if (!docs.includes(docBegin) || !docs.includes(docEnd)) throw new Error('Documentation generation markers are missing');
writeFileSync(docsPath, docs.replace(new RegExp(`${docBegin}[\\s\\S]*?${docEnd}`), `${docBegin}\n${docRows}\n${docEnd}`));

rmSync(workDir, { recursive: true, force: true });
console.log(`Imported ${imported.length} tracks; catalogue total target is 51.`);
