// Offline import of the owner's frozen capture. No fetch, generation or encoding.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertAvailablePublicIds } from './lib/template-public-id.mjs';
import { referenceCount } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { VISUAL_SIGNATURE_METHOD } from './lib/source-visual-signature.mjs';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { validateInputs } from '../lib/generationInputValidation.js';
import { nearestOption } from '../lib/aspectShapes.mjs';
import { publicPromptHygiene } from './lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from './lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from './lib/source-prompt-endings.mjs';
import { SYNTX_100_VIDEO_RECORDS } from '../app/veyrnox/_lib/syntx100VideoRecords.js';
import { SYNTX_100_IMAGE_RECORDS } from '../app/veyrnox/_lib/syntx100ImageRecords.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const input = process.argv[2];
assert.ok(input && !input.startsWith('--'), 'Pass the frozen capture directory');
const checkOnly = process.argv.includes('--check');
const sha = value => createHash('sha256').update(value).digest('hex');
const sourcePath = file => {
  const path = resolve(input, file);
  assert.ok(path.startsWith(resolve(input) + sep), 'Capture path must stay within input');
  return path;
};
const read = file => readFileSync(sourcePath(file));
const manifestSha256 = sha(read('manifest.json')), encodeReportSha256 = sha(read('encode-report.json'));
assert.equal(manifestSha256, '30ffbe337444154e657c0b87b6bb09155ac33054757b35881b82855f28f4dc29');
assert.equal(encodeReportSha256, 'caa71828da3f718968fe7af71ce3f526500b4a5abf4b45fd58afa6948dac997f');
const manifest = JSON.parse(read('manifest.json')), encodes = JSON.parse(read('encode-report.json'));
assert.equal(manifest.length, 96);
assert.equal(encodes.length, 96);
assert.equal(new Set(encodes.map(e => `${e.kind}/${e.slug}`)).size, 96);
for (const kind of ['video', 'image']) assert.equal(manifest.filter(m => m.kind === kind).length, kind === 'video' ? 46 : 50);

const REVIEWED_IMAGE_PHOTO_OVERRIDES = {
  'the-glass': 'USE THE OBJECT/PRODUCT EXACTLY FROM THE REFERENCE IMAGE',
  'a-clear-bottle': 'exactly like the provided photo',
};
// Reviewed against source categories and prompt subject; existing translated keys only.
const REVIEWED_IMAGE_CATEGORIES = {
  'moody-filter': 'YOUR PHOTO', 'particle-filter': 'VFX', 'red-light-filter': 'YOUR PHOTO',
  '2000s-filter': 'YOUR PHOTO', 'ccd-night-shot-filter': 'YOUR PHOTO', 'dark-aesthetic-filter': 'YOUR PHOTO',
  'cinematic-filter': 'YOUR PHOTO', 'iphone-blurry-effect': 'YOUR PHOTO', 'triptych-shooting': 'YOUR PHOTO',
  'bubble-head': 'CARTOONS', 'kissed-in-silence': 'YOUR PHOTO', 'midnight-fuel-stop': 'YOUR PHOTO',
  'black-horsepower': 'YOUR PHOTO', 'face-the-dark': 'YOUR PHOTO', 'upside-down-habit': 'YOUR PHOTO',
  'stylized-caricature': 'CARTOONS', 'sims-style': 'CARTOONS', 'ugly-and-funny-doodle-2': 'CARTOONS',
  'viral-doodle': 'CARTOONS', 'gta-vi-style': 'CARTOONS', 'bold-type-product': 'PRODUCTS',
  'lego-style': 'CARTOONS', 'gta-sa-style': 'CARTOONS', 'black-white-2': 'YOUR PHOTO',
  'cinematic-portrait': 'REALISTIC', 'hotel-corridor': 'REALISTIC', 'pool-toys': 'REALISTIC',
  'climbing': 'YOUR PHOTO', 'stained-glass-window': 'REALISTIC', 'black-white': 'REALISTIC',
  'sunflower-field': 'REALISTIC', 'massive-ocean-wave': 'REALISTIC', 'towering-cliffs': 'REALISTIC',
  'swim-rings': 'REALISTIC', 'giant-footballs': 'REALISTIC', 'enormous-basketballs': 'REALISTIC',
  'borscht': 'REALISTIC', 'huge-model': 'YOUR PHOTO', 'bottle-of-red-wine': 'REALISTIC',
  'melting-deforming': 'PRODUCTS', 'a-wet-transparent-glass': 'PRODUCTS', 'composition-of-yuzu': 'PRODUCTS',
  'floral-perfume-campaign': 'PRODUCTS', 'the-glass': 'PRODUCTS', 'silhouette': 'PRODUCTS',
  'stretch-effect': 'PRODUCTS', 'monochromatic': 'PRODUCTS', 'sneaker-campaign': 'YOUR PHOTO',
  'a-clear-bottle': 'PRODUCTS', 'pomegranate-jewel': 'PRODUCTS',
};
const PUBLIC_IDS = {
  'helicopter-jump-2': 'helicopter-jump-two',
  'rig-it-right-for-gta': 'game-character-rig', 'home-alone-again': 'holiday-home-recast',
  '500-days-of-summer': 'summer-romance-recast', 'gta-vi-style': 'neon-city-game-portrait',
  'sims-style': 'life-simulation-portrait', 'lego-style': 'toy-brick-portrait',
  'gta-sa-style': 'retro-game-loading-portrait', 'football-legends': 'football-duo-recast',
  'lil-tjan': 'stage-performer-recast', 'rumpelstiltskin': 'fairytale-villain-recast',
  'iphone-blurry-effect': 'handheld-blur-effect', 'bad-santa-run': 'holiday-heist-run',
  'reality-in-wonderland': 'storybook-reality-recast',
  // Distinguish the source's two identically titled images.
  'black-white-2': 'shadow-beard-portrait', 'black-white': 'ripple-light-portrait',
};
const PUBLIC_NAMES = {
  "rig-it-right-for-gta": "GAME CHARACTER RIG",
  "home-alone-again": "HOLIDAY HOME RECAST",
  "500-days-of-summer": "SUMMER ROMANCE RECAST",
  "gta-vi-style": "NEON CITY GAME PORTRAIT",
  "sims-style": "LIFE SIMULATION PORTRAIT",
  "lego-style": "TOY BRICK PORTRAIT",
  "gta-sa-style": "RETRO GAME LOADING PORTRAIT",
  "football-legends": "FOOTBALL DUO RECAST",
  "lil-tjan": "STAGE PERFORMER RECAST",
  "rumpelstiltskin": "FAIRYTALE VILLAIN RECAST",
  "iphone-blurry-effect": "HANDHELD BLUR EFFECT",
  "bad-santa-run": "HOLIDAY HEIST RUN",
  "reality-in-wonderland": "STORYBOOK REALITY RECAST",
  "black-white-2": "SHADOW BEARD PORTRAIT",
  "black-white": "RIPPLE LIGHT PORTRAIT",
  "helicopter-jump-2": "HELICOPTER JUMP TWO"
};
const REVIEWED_VIDEO_CATEGORIES = {
  "london-london": "MOVIES",
  "home-alone-again": "MOVIES",
  "500-days-of-summer": "MOVIES",
  "3-friends": "MOVIES",
  "taxi-chase": "MOVIES",
  "rumpelstiltskin": "MOVIES",
  "reality-in-wonderland": "CARTOONS",
  "outfit-transition-gone-crazy": "FASHION",
  "blow-and-throw": "REALISTIC",
  "flaming-candle-blowout": "REALISTIC",
  "lil-tjan": "REALISTIC",
  "ride-the-beat": "REALISTIC",
  "football-legends": "REALISTIC",
  "surprise-knockout-kick": "REALISTIC",
  "fans-go-wild": "REALISTIC",
  "desert-chase": "REALISTIC",
  "street-phantom": "REALISTIC",
  "on-the-winter-roof": "REALISTIC",
  "new-year-on-the-nose": "REALISTIC",
  "bad-santa-run": "REALISTIC",
  "the-winning-gift": "REALISTIC",
  "dance-in-the-snow": "REALISTIC",
  "drift-therapy": "REALISTIC",
  "dj-performance": "REALISTIC",
  "athlete-flex": "REALISTIC",
  "helicopter-jump-2": "REALISTIC",
  "landing": "REALISTIC",
  "fridge-down": "REALISTIC",
  "hyenas-run": "REALISTIC",
  "burn-it-to-ashes": "REALISTIC",
  "helicopter-jump": "REALISTIC",
  "hand-frame-switch": "CINEMATIC",
  "light-and-blow": "CINEMATIC",
  "cake-in-the-fridge": "CINEMATIC",
  "one-breath-wish": "CINEMATIC",
  "make-a-wish": "CINEMATIC",
  "epic-arrival": "CINEMATIC",
  "retro-groove": "CINEMATIC",
  "kick-and-run": "CINEMATIC",
  "carousel": "CINEMATIC",
  "wish-a-merry-christmas": "CINEMATIC",
  "rig-it-right-for-gta": "CINEMATIC",
  "the-bigger-gift": "CINEMATIC",
  "one-more-dance": "CINEMATIC",
  "snowball-revenge": "CINEMATIC",
  "rope-swing": "CINEMATIC"
};
const SOURCE_MODEL_LABELS = { 'seedance-2.0': 'Seedance 2.0', 'seedance-2.5': 'Seedance 2.5', kling_4_omni: 'Kling 4 Omni', wan_30_omni: 'Wan 3.0 Omni', wan_30_reference: 'Wan 3.0 Reference', grok_i2v: 'Grok I2V' };
const BLOCK = /\b(nude|naked|nsfw|porn|erotic|sex(?:ual|y)?|lingerie|topless|bikini|strip(?:per|tease)|fetish|boob|breast|nipple|underage|minor|child(?:ren)?|kid|toddler|baby|teen(?:ager)?|schoolgirl|loli|rape|gore|beheaded|blood(?:y)?|suicide|nazi|hitler|swastika|terroris|isis|kkk|slur|crypto|bitcoin|wallet|airdrop|nft)\b/i;
const REAL = /\b(trump|biden|obama|putin|zelensk|elon musk|taylor swift|beyonc|kardashian|messi|ronaldo|mbapp|neymar|lebron|drake|eminem|rihanna|kanye|diddy|epstein)\b/i;
const REVIEWED_CONTENT_ALLOWLIST = {
  'retro-groove': { term: 'minor', reason: 'minor character reference; a secondary character' },
  'bad-santa-run': { term: 'children', reason: "children's letters and drawings as props" },
  'ugly-and-funny-doodle-2': { term: 'child', reason: "similar to a child's crayon drawing; a style description" },
};
const refused = JSON.parse(readFileSync(resolve(root, 'scripts/lib/refused-source-records.json')));
const rejectedAfterInspection = JSON.parse(read('rejected-after-inspection.json'));
for (const row of rejectedAfterInspection) assert.ok(refused.some(r => r.sourceRecordId === row.sourceRecordId));
for (const row of manifest) {
  assert.ok(!refused.some(r => r.sourceRecordId === row.sourceRecordId), row.slug + ': refused source record');
  const text = row.prompt + '\n' + row.title, matches = [...text.matchAll(new RegExp(BLOCK.source, 'gi'))];
  assert.equal(REAL.test(text), false, row.slug + ': real-person screen');
  const decision = REVIEWED_CONTENT_ALLOWLIST[row.slug];
  for (const matched of matches) assert.equal(matched[0].toLowerCase(), decision?.term, row.slug + ': unreviewed content match');
  if (decision) assert.ok(matches.length, row.slug + ': stale content decision');
}
const publicId = m => PUBLIC_IDS[m.slug] || m.slug;
const auditPath = resolve(root, 'docs/product/source-audit/syntx-100-exact-2026-11-13.json');
const previousAudit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath)) : null;
const ownIds = [...Object.keys(SYNTX_100_VIDEO_RECORDS), ...Object.keys(SYNTX_100_IMAGE_RECORDS)];
assertAvailablePublicIds(manifest.map(publicId), ownIds);
const normalized = prompt => sha(prompt.trim().replace(/\s+/g, ' ').toLowerCase());
// Include historic modules outside the published registry, including retired captures.
const prior = new Map();
for (const file of readdirSync(resolve(root, 'app/veyrnox/_lib')).filter(f => f.endsWith('Records.js'))) {
  const recordModule = await import(pathToFileURL(resolve(root, 'app/veyrnox/_lib', file)));
  for (const records of Object.values(recordModule)) if (records && typeof records === 'object') {
    for (const [id, r] of Object.entries(records)) if (typeof r?.prompt === 'string' && !ownIds.includes(id)) prior.set(id, r);
  }
}
const seen = [new Set(), new Set(), new Set()];
for (const r of prior.values()) [r.sourceRecordId, r.sourceMediaId, normalized(r.prompt)].forEach((v, i) => { if (v) seen[i].add(v); });
for (const m of manifest) {
  assert.equal(sha(m.prompt), m.promptSha256, m.slug + ': prompt');
  assert.doesNotMatch(m.prompt, /syntx/i);
  [m.sourceRecordId, m.media.sourceMediaId, normalized(m.prompt)].forEach((v, i) => {
    assert.ok(v && !seen[i].has(v), `${m.slug}: duplicate identity ${i}`); seen[i].add(v);
  });
}
const files = [];
function verify(file, hash, bytes, cap = Infinity) {
  const data = read(file);
  assert.equal(sha(data), hash, file);
  assert.equal(data.length, bytes, file);
  assert.ok(data.length <= cap, file + ': size budget');
}
const videoRecords = {}, imageRecords = {}, videos = [], images = [], records = [], rejected = [...rejectedAfterInspection];
const gatewayAccepts = aspect => validateInputs({ prompt: 'Aspect validation', aspect_ratio: aspect }).ok;
const aspects = capabilityFor('grsai:nano-banana-pro-edit').inputs.aspect_ratio.values.filter(gatewayAccepts);
const textAspects = fallbackCapabilitiesFor('nano-banana-kie').inputs.aspect_ratio.values.filter(gatewayAccepts);
const visualPath = resolve(root, 'tests/fixtures/exactOnlyVisualSignatures.json');
const signatures = JSON.parse(readFileSync(visualPath)).placements;
for (const m of manifest) {
  const e = encodes.find(e => e.slug === m.slug && e.kind === m.kind), id = publicId(m);
  assert.ok(e, m.slug);
  for (const asset of [m.media, m.poster].filter(Boolean)) verify(asset.file, asset.sha256, asset.bytes);
  assert.equal(e.sourceSha256, m.media.sha256);
  const previewPath = m.kind === 'video' ? `/showcase/creator-${id}.mp4` : `/showcase/images/${id}.webp`;
  const posterPath = m.kind === 'video' ? `/showcase/creator-${id}.jpg` : null;
  const outputs = m.kind === 'video'
    ? [[e.videoFile, e.videoSha256, e.videoBytes, 6 * 1024 * 1024, previewPath], [e.posterFile, e.posterSha256, e.posterBytes, 80 * 1024, posterPath]]
    : [[e.imageFile, e.imageSha256, e.imageBytes, 250 * 1024, previewPath]];
  if (m.kind === 'video') {
    assert.equal(e.startSeconds, 0);
    assert.equal(e.audio, false, m.slug + ': host report must declare silent video');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', sourcePath(e.videoFile)], { encoding: 'utf8', timeout: 30000 }));
    assert.deepEqual(probe.streams.map(stream => stream.codec_type), ['video'], m.slug + ': exactly one video stream; no audio/data/timecode');
  }
  else assert.ok(Math.max(e.width, e.height) <= 1080);
  for (const [file, hash, bytes, cap, destination] of outputs) {
    verify(file, hash, bytes, cap);
    const path = resolve(root, 'public' + destination);
    const currentHash = existsSync(path) ? sha(readFileSync(path)) : null;
    if (currentHash && currentHash !== hash) {
      assert.equal(checkOnly, false, destination + ': regenerate');
      // Only replace the same selected video's previously recorded, unmodified preview.
      const previous = previousAudit?.records.find(r => r.id === id);
      assert.equal(previousAudit?.manifestSha256, manifestSha256);
      assert.ok(m.kind === 'video' && destination === previewPath, destination + ': only video previews may be refreshed');
      assert.equal(previous?.sourceAssetSha256, m.media.sha256);
      assert.equal(previous?.previewPath, destination);
      assert.equal(currentHash, previous?.localPreviewSha256, destination + ': refusing to overwrite an unrecorded edit');
    }
    files.push({ file, path, hash, currentHash });
  }
  // Any platform stripping would break byte exactness; reject, never substitute.
  if (/\b(?:higgsfield|syntx)\s+/i.test(m.prompt)) {
    rejected.push({ id, sourceRecordId: m.sourceRecordId, sourcePromptSha256: m.promptSha256, reason: 'Platform-word stripping would rewrite the exact source prompt.' });
    files.splice(files.length - outputs.length);
    continue;
  }
  const name = PUBLIC_NAMES[m.slug] || m.title.toUpperCase();
  const raw = { prompt: m.prompt, promptSha256: m.promptSha256, sourcePromptAvailable: true,
    sourceAuditStatus: 'verified-2026-11-13', sourceRecordId: m.sourceRecordId, sourceMediaId: m.media.sourceMediaId,
    sourceTitle: m.title, sourceSlug: m.slug, sourceModel: m.sourceModel, sourceModelFamily: m.sourceModelFamily,
    sourceAspect: m.aspect, sourceMinFiles: m.sourceMinFiles, sourceGenerationSettings: m.sourceSettings };
  let recipe;
  if (m.kind === 'image') {
    assert.ok([0, 1].includes(m.sourceMinFiles), m.slug + ': image sourceMinFiles');
    const override = REVIEWED_IMAGE_PHOTO_OVERRIDES[m.slug];
    if (override) assert.ok(m.prompt.includes(override));
    const photo = m.sourceMinFiles >= 1 || Boolean(override);
    const aspect = photo && !aspects.includes(m.aspect) ? nearestOption(m.aspect, aspects) : m.aspect;
    assert.ok(aspect, m.slug + ': supported aspect');
    assert.ok(photo || textAspects.includes(aspect));
    assert.ok(REVIEWED_IMAGE_CATEGORIES[m.slug], m.slug + ': reviewed category');
    recipe = { id, name, model: photo ? 'nano-banana-pro-edit-grsai' : 'nano-banana-kie', aspect,
      ...(photo ? { photo: { required: true, count: 1 } } : {}), category: REVIEWED_IMAGE_CATEGORIES[m.slug],
      previewImage: previewPath, previewAspect: `${e.width} / ${e.height}`,
      bg: 'linear-gradient(145deg,#152a38,#61516c 65%,#be9b7d)', promptOrigin: 'community-source-exact' };
    imageRecords[id] = raw; images.push(recipe);
  } else {
    const needsReference = referenceCount(m.prompt, 'image') || referenceCount(m.prompt, 'video') || /\b(audio|music|soundtrack|speech|lip[ -]?sync|voice|dialogue)\b/i.test(m.prompt) || m.prompt.length > 30000;
    const category = REVIEWED_VIDEO_CATEGORIES[m.slug];
    assert.ok(category, m.slug + ': reviewed video category');
    assert.ok(SOURCE_MODEL_LABELS[m.sourceModel], m.slug + ': model display label');
    recipe = { id, name, clipKey: id, model: 'Seedance 2.0 Fast', credits: 19, durationSeconds: 5,
      category, isNew: true, previewAspect: `${e.width} / ${e.height}`, sourceAspect: nearestOption(`${e.width}:${e.height}`, ['1:1', '16:9', '9:16']),
      bg: 'linear-gradient(155deg,#0d1525 0%,#334c73 55%,#9a6f86 100%)',
      needs: needsReference ? 'Copy the exact prompt; its required reference media or preserved audio is not wired into generation' : null,
      needsKey: needsReference ? 'community.copyOnly' : null,
      sourceModel: SOURCE_MODEL_LABELS[m.sourceModel], sourcePlatform: 'Syntx', sourceUrl: `https://syntx.ai/trends/${m.slug}`,
      steps: needsReference ? ['Prepare your starting image using the guidance above.', 'Use this template to load its prompt and settings in the studio.', 'Upload your image, edit the prompt if needed, and review the price before generating.'] : ['Use this template to load its prompt and settings in the studio.', 'Describe your characters and setting, then review the price before generating.'], inspired: false };
    videoRecords[id] = raw; videos.push(recipe);
  }
  records.push({ id, kind: m.kind, ...raw, sourcePromptSha256: m.promptSha256, normalizedPromptSha256: normalized(m.prompt),
    sourceAssetSha256: m.media.sha256, sourceMediaUrl: m.media.sourceUrl, sourceMedia: m.media, sourcePoster: m.poster ?? null,
    sourceSettings: m.sourceSettings, publishedAt: m.publishedAt, sourceCategories: m.categories, sourceTags: m.tags,
    sourceDuration: m.duration, sourceReferenceCounts: m.referenceCounts, inputAssetCount: m.sourceMinFiles,
    referenceImageCount: referenceCount(m.prompt, 'image'), referenceVideoCount: referenceCount(m.prompt, 'video'),
    ...recipe, sourceModel: m.sourceModel, sourceAspect: m.aspect, runtimeAspect: recipe.aspect || recipe.sourceAspect, previewPath, ...(posterPath ? { posterPath } : {}),
    ...(m.kind === 'video' ? { sourceVideoSignature: signatures[id]?.signature ?? null, signatureFrameCount: signatures[id]?.frames ?? null,
      startSeconds: e.startSeconds, localPreviewSha256: e.videoSha256, localPreviewBytes: e.videoBytes, localPosterSha256: e.posterSha256, localPosterBytes: e.posterBytes }
      : { photoOverride: REVIEWED_IMAGE_PHOTO_OVERRIDES[m.slug] ?? null, localPreviewSha256: e.imageSha256, localPreviewBytes: e.imageBytes }),
    encode: e });
}
assert.equal(Object.keys(REVIEWED_IMAGE_CATEGORIES).length, 50);
assert.equal(images.filter(r => r.photo).length, 37);
assert.equal(images.filter(r => !r.photo).length, 13);
assert.equal(new Set([...videos, ...images].map(r => r.name)).size, records.length);
assert.deepEqual(Object.fromEntries(['MOVIES', 'CARTOONS', 'ANIME', 'FASHION', 'REALISTIC', 'CINEMATIC'].map(c => [c, videos.filter(v => v.category === c).length])), { MOVIES: 6, CARTOONS: 1, ANIME: 0, FASHION: 1, REALISTIC: 23, CINEMATIC: 15 });
// All capture validation finishes before any output is written.
for (const { file, path, hash, currentHash } of files) {
  if (!checkOnly && currentHash !== hash) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = mkdtempSync(resolve(dirname(path), '.syntx-import-'));
    try {
      const staged = resolve(temporary, 'preview');
      copyFileSync(sourcePath(file), staged);
      assert.equal(sha(readFileSync(staged)), hash, file);
      renameSync(staged, path); // Capture files may be read-only; replace within the writable checkout.
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  assert.equal(sha(readFileSync(path)), hash, path);
}
const write = (file, value) => {
  const path = resolve(root, file);
  if (checkOnly) assert.equal(readFileSync(path, 'utf8'), value, file + ': regenerate');
  else writeFileSync(path, value);
};
const header = '// Generated by scripts/import-syntx-100-exact.mjs; frozen source bytes, do not rewrite.\n';
for (const [file, symbol, value] of [['syntx100VideoRecords', 'SYNTX_100_VIDEO_RECORDS', videoRecords], ['syntx100ImageRecords', 'SYNTX_100_IMAGE_RECORDS', imageRecords]]) {
  write(`app/veyrnox/_lib/${file}.js`, header + `export const ${symbol} = Object.freeze({\n` + Object.entries(value).map(([id, r]) => `  ${JSON.stringify(id)}: ${JSON.stringify(r)}`).join(',\n') + '\n});\n');
}
write('app/veyrnox/_lib/sourceTemplateExpansion19.js', header + 'export const SYNTX_100_VIDEO_TEMPLATES = Object.freeze([\n' + videos.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]);\nexport const SYNTX_100_SHOWCASE_CLIPS = Object.fromEntries(SYNTX_100_VIDEO_TEMPLATES.map(t => [t.id, {\n  video: `/showcase/creator-${t.id}.mp4`, poster: `/showcase/creator-${t.id}.jpg`, aspectRatio: t.previewAspect, title: t.name.toLowerCase().replace(/(^|\\s)\\S/g, letter => letter.toUpperCase()),\n}]));\n');
write('app/veyrnox/_lib/imageTemplatesSyntx100.js', header + "import { SYNTX_100_IMAGE_RECORDS } from './syntx100ImageRecords.js';\nexport const SYNTX_100_IMAGE_TEMPLATES = Object.freeze([\n" + images.map(r => '  ' + JSON.stringify(r)).join(',\n') + "\n].map(t => Object.freeze({ ...t, kind: 'image', isNew: true, ...(t.photo ? { photo: Object.freeze(t.photo) } : {}), prompt: SYNTX_100_IMAGE_RECORDS[t.id].prompt })));\n");
write('tests/fixtures/syntx100PromptHashes.json', JSON.stringify(Object.fromEntries(manifest.map(m => [publicId(m), m.promptSha256])), null, 2) + '\n');
write('docs/product/source-audit/syntx-100-exact-2026-11-13.json', JSON.stringify({ source: 'Syntx Trends', api: 'https://api.syntx.ai/api/v1/trends', auditedAt: '2026-11-13', requested: 96, accepted: records.length,
  manifestSha256, encodeReportSha256, contentScreen: { block: BLOCK.source, real: REAL.source, reviewed: REVIEWED_CONTENT_ALLOWLIST }, visualSignatureMethod: VISUAL_SIGNATURE_METHOD, rejected, droppedForSyntxBranding: JSON.parse(read('dropped.json')),
  reviewedImagePhotoOverrides: REVIEWED_IMAGE_PHOTO_OVERRIDES, reviewedImageCategories: REVIEWED_IMAGE_CATEGORIES, publicIds: PUBLIC_IDS, publicNames: PUBLIC_NAMES, reviewedVideoCategories: REVIEWED_VIDEO_CATEGORIES,
  publicPromptHygiene: publicPromptHygiene(records), 'source-reference-gaps': sourceReferenceGaps(records), 'ending-review': sourcePromptEndingReview(records), records }, null, 2) + '\n');
const docPath = 'docs/product/showcase-clips.md', doc = readFileSync(resolve(root, docPath), 'utf8');
const begin = '<!-- BEGIN SYNTX 100 EXACT -->', end = '<!-- END SYNTX 100 EXACT -->';
const section = `${begin}\n## 13 November 2026: 46 video and 50 image Syntx captures\n\nExact gallery media, encoded by the host and shipped by owner decision. All original and prepared asset hashes are verified offline; video previews start at 0 seconds and contain exactly one video stream with no audio or data tracks. Prompts remain byte-exact. See [the audit](source-audit/syntx-100-exact-2026-11-13.json) and [ADR-0341](../adr/0341-syntx-50-video-50-image-exact.md).\n\n| Public id | Kind | Source title | Source asset |\n| --- | --- | --- | --- |\n${records.map(r => `| ${r.id} | ${r.kind} | ${r.sourceTitle.replaceAll('|', '\\|')} | [Syntx](${r.sourceMediaUrl}) |`).join('\n')}\n${end}`;
write(docPath, doc.includes(begin) ? doc.slice(0, doc.indexOf(begin)) + section + doc.slice(doc.indexOf(end) + end.length) : doc.trimEnd() + '\n\n' + section + '\n');
console.log(`${checkOnly ? 'Checked' : 'Imported'} ${videos.length} video + ${images.length} image templates; ${images.filter(r => r.photo).length} photo-required / ${images.filter(r => !r.photo).length} text-only; ${records.reduce((n, r) => n + r.localPreviewBytes + (r.localPosterBytes || 0), 0)} shipped bytes; all prompt, original media/poster and encoded hashes verified; ${rejected.length} rejected.`);
