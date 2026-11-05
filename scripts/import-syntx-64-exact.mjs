// Offline import of the owner's frozen 2026-11-05 capture. No network or encoding.
import assert from 'node:assert/strict';
import { referenceCount } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { publicPromptHygiene } from './lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from './lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from './lib/source-prompt-endings.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAvailablePublicIds } from './lib/template-public-id.mjs';
import { SYNTX_64_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptExpansion64Records.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const input = process.argv[2];
const checkOnly = process.argv.includes('--check');
if (!input) throw new Error('Pass the read-only input-syntx directory');
const read = file => readFileSync(resolve(input, file));
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(read('manifest.json'));
const encodes = JSON.parse(read('encode-report.json'));
assert.equal(manifest.length, 64);
assert.equal(encodes.length, 64);
// Word boundaries prevent image/productive/address substring matches. Reviewed
// overrides describe the actual scene, not incidental instructions or negatives.
function category(prompt) {
  if (/\banime\b/i.test(prompt)) return 'ANIME';
  if (/\b(?:cartoon|animated|animation)\b/i.test(prompt)) return 'CARTOONS';
  if (/\b(?:advertisement|commercial)\b/i.test(prompt)) return 'ADS';
  if (/\b(?:product|packaging|jewelry|perfume)\b/i.test(prompt)) return 'PRODUCTS';
  if (/\b(?:fashion|outfit|runway|wardrobe|editorial|dress|jacket)\b/i.test(prompt)) return 'FASHION';
  if (/\b(?:fantasy|magic|mage|dragon|demon|supernatural)\b/i.test(prompt)) return 'FANTASY';
  if (/\b(?:vfx|transform|morph|shockwave)\b/i.test(prompt)) return 'VFX';
  return 'CINEMATIC';
}
const REVIEWED_CATEGORIES = {
  'fancy-cafe':'REALISTIC', 'morning-coffee':'REALISTIC', 'jenner':'REALISTIC',
  'drakula-cruise':'MOVIES', 'tilted-melody':'REALISTIC', 'the-giant-caretaker':'FANTASY',
  'ocean-car-sinking':'CINEMATIC', 'vice-city-freefall':'MOVIES', 'edge-of-victory':'CINEMATIC',
  'what-falls-next':'CINEMATIC', 'office-kitchen':'MOVIES', 'catch-of-the-day':'PRODUCTS',
  'the-beast-awakens':'FANTASY', 'grab-heist':'ADS', 'office-escape':'FANTASY',
  'animal-pov-to-the-club':'FANTASY', 'sketch-to-real-car':'PRODUCTS', 'car-sky-fall':'VFX',
  'on-game':'VFX', 'frozen-time':'VFX', 'with-animal':'VFX', 'remote-control':'VFX',
  'breaking-good':'MOVIES', 'the-spirit':'FANTASY', 'on-the-road':'CINEMATIC',
  'the-crown':'FANTASY', 'dragon-lord':'FANTASY', 'noir-film':'MOVIES', 'desert-rider':'CINEMATIC',
  'behind-the-scenes':'VFX', 'split-jump':'ADS', 'impact':'MOVIES', 'tomb-rider':'MOVIES',
  'alice-in-wonderland':'FANTASY', 'born-from-sand':'VFX', 'levitation':'PRODUCTS',
  'freefall':'ADS', 'gentle-monster-disney':'ADS', 'rotation-360':'VFX',
  'above-the-head':'FANTASY', 'magical-reality':'ANIME', 'the-last-flame':'FANTASY',
  'pov-avatar':'FANTASY', 'the-dune':'FANTASY', 'pov-dragon-flight':'FANTASY',
  'the-machine':'VFX', 'city-tunnel':'CINEMATIC', 'industrial':'REALISTIC', 'ice-golem':'FANTASY',
  'dark-horror':'MOVIES', 'jazz-lounge':'ANIME', 'armored-knight':'ANIME', 'red-koi-fish':'FANTASY',
  'young-samurai':'ANIME', 'wonka-world':'FANTASY', 'dont-touch-the-braids':'VFX',
  'the-lost-ghost':'CARTOONS', 'last-supper':'ANIME', 'firebird':'FANTASY',
  'x-ray-matter':'VFX', 'edit-the-sky':'VFX', 'sea-snakes':'FANTASY', 'the-matrix':'MOVIES',
};
const PUBLIC_NAMES = {
  'jenner':'CROWD CHOREOGRAPHY RECAST', 'gentle-monster-disney':'SCULPTURAL SUNGLASSES AD',
  'the-matrix':'ROOFTOP AGENT PURSUIT', 'alice-in-wonderland':'CURIOUS GARDEN JOURNEY',
  'wonka-world':'CHOCOLATE FACTORY FLIGHT', 'tomb-rider':'RUINS ESCAPE RUN',
  'breaking-good':'UNDERGROUND LAB TRANSFORMATION', 'vice-city-freefall':'NEON CITY FREEFALL',
  'pov-avatar':'ALIEN FOREST FLIGHT', 'the-dune':'DESERT WORM FLIGHT',
  'drakula-cruise':'VAMPIRE VOYAGE',
};
const PUBLIC_IDS = {
  'jenner':'crowd-choreography-recast',
  'gentle-monster-disney':'sculptural-sunglasses-ad',
  'the-matrix':'rooftop-agent-pursuit',
  'alice-in-wonderland':'curious-garden-journey',
  'wonka-world':'chocolate-factory-flight',
  'tomb-rider':'ruins-escape-run',
  'breaking-good':'underground-lab-transformation',
  'vice-city-freefall':'neon-city-freefall',
  'pov-avatar':'alien-forest-flight',
  'the-dune':'desert-worm-flight',
  'drakula-cruise':'vampire-voyage',
};
assert.equal(Object.keys(PUBLIC_IDS).length, 11);
assert.deepEqual(Object.keys(PUBLIC_IDS).sort(), Object.keys(PUBLIC_NAMES).sort());
for (const [slug, id] of Object.entries(PUBLIC_IDS)) {
  assert.equal(id, PUBLIC_NAMES[slug].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}
const accepted = manifest.filter(m => m.slug !== 'dark-couture');
const mediaIds = new Set(accepted.map(m => m.sourceMediaId));
const ownIds = Object.entries(SYNTX_64_SOURCE_PROMPT_RECORDS).filter(([, r]) => mediaIds.has(r.sourceMediaId)).map(([id]) => id);
assertAvailablePublicIds(accepted.map(m => PUBLIC_IDS[m.slug] || m.slug), ownIds);
const SOURCE_MODEL_LABELS = {
  'seedance-2.0':'Seedance 2.0', 'seedance-2.5':'Seedance 2.5',
  'kling_4_omni':'Kling 4 Omni', 'kling_image2video':'Kling Image-to-Video',
  'grok_15_i2v':'Grok 1.5 I2V', 'flux3_t2v':'Flux 3 T2V', 'flux3_i2v':'Flux 3 I2V',
};
// The Seedance importer's generatedInputGuidance checks compatibility first.
// These flags remain informational; neither guidance nor routing blocks submission.
function inputGuidance(record) {
  if (record.referenceImageCount || record.referenceVideoCount || record.requiresPreservedAudio || record.prompt.length > 30000) return {
    needs: 'Copy the exact prompt; its required reference media or preserved audio is not wired into generation', needsKey: 'community.copyOnly',
  };
  if (record.referenceImageCount === 0) return {needs:null, needsKey:null};
  return record.referenceImageCount > 1
    ? {needs:'One starting image containing every subject in their intended positions', needsKey:'community.group'}
    : {needs:'A clear full-body portrait with room for cinematic movement', needsKey:'community.cinematic'};
}
const auditPath = resolve(root, 'docs/product/source-audit/syntx-64-exact-2026-11-05.json');
let signatures = {}, signatureFrames = {}, visualSignatureMethod;
try { const prior = JSON.parse(readFileSync(auditPath)); signatures = Object.fromEntries(prior.records.map(r => [r.sourceSlug, r.sourceVideoSignature])); signatureFrames = Object.fromEntries(prior.records.map(r => [r.sourceSlug, r.signatureFrameCount])); visualSignatureMethod = prior.visualSignatureMethod; } catch { /* First import; host can supply decoded signatures separately. */ }
const records = {}, recipes = [], audit = [], rejected = [];
for (const m of manifest) {
  const e = encodes.find(e => e.slug === m.slug);
  if (m.slug === 'dark-couture') {
    rejected.push({id:m.slug, sourceRecordId:m.sourceRecordId, sourceMediaId:m.sourceMediaId, sourcePromptSha256:m.promptSha256, sourceAssetSha256:m.videoSha256, localPreviewSha256:e.videoSha256, localPosterSha256:e.posterSha256, reason:'Platform-word stripping removes nine SYNTX AI typography mentions, materially rewriting the community prompt.'});
    for (const ext of ['mp4','jpg']) {
      const file = resolve(root, `public/showcase/creator-${m.slug}.${ext}`);
      if (checkOnly) assert.equal(existsSync(file), false, file); else rmSync(file, {force:true});
    }
    continue;
  }
  const id = PUBLIC_IDS[m.slug] || m.slug;
  assert.ok(e, m.slug);
  assert.equal(sha(m.prompt), m.promptSha256, m.slug);
  assert.equal(sha(read(`media/${m.videoFile}`)), m.videoSha256, m.slug);
  assert.equal(e.sourceSha256, m.videoSha256, m.slug);
  assert.equal(e.startSeconds, 0);
  for (const [ext, hash, bytes, cap] of [['mp4', e.videoSha256, e.videoBytes, 6 * 1024 * 1024], ['jpg', e.posterSha256, e.posterBytes, 80 * 1024]]) {
    const data = read(`encoded/${m.slug}.${ext}`);
    assert.equal(sha(data), hash, m.slug);
    assert.equal(data.length, bytes, m.slug);
    assert.ok(bytes <= cap, m.slug);
    const destination = resolve(root, `public/showcase/creator-${id}.${ext}`);
    const previous = resolve(root, `public/showcase/creator-${m.slug}.${ext}`);
    if (existsSync(destination)) assert.equal(sha(readFileSync(destination)), hash, id);
    if (previous !== destination && existsSync(previous)) {
      assert.equal(sha(readFileSync(previous)), hash, m.slug);
      assert.equal(checkOnly, false, m.slug + ': obsolete public media path');
      assert.equal(existsSync(destination), false, id + ': refusing to overwrite a second file');
      renameSync(previous, destination);
    } else if (!existsSync(destination) && !checkOnly) {
      copyFileSync(resolve(input, `encoded/${m.slug}.${ext}`), destination);
    }
    assert.equal(sha(readFileSync(destination)), hash, id);

  }
  const sourceModel = SOURCE_MODEL_LABELS[m.settings.model_type];
  assert.ok(sourceModel, m.settings.model_type);
  const referenceImageCount = referenceCount(m.prompt, 'image'), referenceVideoCount = referenceCount(m.prompt, 'video');
  const requiresPreservedAudio = /\b(audio|music|soundtrack|speech|lip[ -]?sync|voice|dialogue)\b/i.test(m.prompt);
  const guidance = inputGuidance({referenceImageCount, referenceVideoCount, requiresPreservedAudio, prompt:m.prompt});
  const referenceRoute = guidance.needsKey === 'community.group' || guidance.needsKey === 'community.cinematic';
  const model = referenceRoute ? 'Kling 3.0 · I2V' : 'Seedance 2.0 Fast';
  const publicName = PUBLIC_NAMES[m.slug] || m.name;
  const reviewedCategory = REVIEWED_CATEGORIES[m.slug] || category(m.prompt);
  assert.ok(REVIEWED_CATEGORIES[m.slug], m.slug + ': category must be reviewed');
  const previewAspect = `${m.width} / ${m.height}`;
  const sourceAspect = Math.abs(Math.log(m.width / m.height)) < 0.16 ? '1:1' : m.width > m.height ? '16:9' : '9:16';
  records[id] = { prompt: m.prompt, sourcePromptAvailable: true, sourceAuditStatus: 'verified-2026-11-05', sourceRecordId: m.sourceRecordId, sourceMediaId: m.sourceMediaId, sourceTitle: m.title, sourceSlug: m.slug };
  recipes.push({ id, name: publicName, clipKey: id, model, credits: referenceRoute ? 32 : 19, durationSeconds: referenceRoute ? 10 : 5, category: reviewedCategory, isNew: true, previewAspect, sourceAspect,
    bg: 'linear-gradient(155deg,#0d1525 0%,#334c73 55%,#9a6f86 100%)',
    ...guidance,
    sourceModel, sourcePlatform: 'Syntx', sourceUrl: `https://syntx.ai/trends/${m.slug}`,
    steps: guidance.needsKey === 'community.copyOnly' ? ['Prepare your starting image using the guidance above.', 'Use this template to load its prompt and settings in the studio.', 'Upload your image, edit the prompt if needed, and review the price before generating.'] : ['Use this template to load its prompt and settings in the studio.', 'Describe your characters and setting, then review the price before generating.'], inspired: false });
  audit.push({ id, sourceRecordId: m.sourceRecordId, sourceTitle: m.title, sourceSlug: m.slug, sourceMediaId: m.sourceMediaId, sourceMediaUrl: m.sourceVideoUrl, sourceAssetSha256: m.videoSha256,
    sourceVideoSignature: signatures[m.slug] ?? null, ...(signatureFrames[m.slug] ? { signatureFrameCount: signatureFrames[m.slug] } : {}), sourcePromptSha256: m.promptSha256, normalizedPromptSha256: sha(m.prompt.trim().replace(/\s+/g,' ').toLowerCase()), sourceAuditStatus: 'verified-2026-11-05', prompt: m.prompt,
    name: publicName, category: reviewedCategory, categoryRuleResult: category(m.prompt), previewAspect, sourceModel, sourceSettings: { ...m.settings, sourceProvider: m.model }, referenceImageCount, referenceVideoCount, requiresPreservedAudio, model, needs: guidance.needs, needsKey: guidance.needsKey,
    localPreviewSha256: e.videoSha256, localPreviewBytes: e.videoBytes, localPosterSha256: e.posterSha256, localPosterBytes: e.posterBytes,
    previewPath: `/showcase/creator-${id}.mp4`, posterPath: `/showcase/creator-${id}.jpg`, startSeconds: e.startSeconds });
}
const write = (file, text) => {
  const path = resolve(root, file);
  if (checkOnly) assert.equal(readFileSync(path, 'utf8'), text, file + ': regenerate');
  else writeFileSync(path, text);
};
write('app/veyrnox/_lib/syntxSourcePromptExpansion64Records.js', '// Raw source text from the frozen anonymous Trends capture; do not rewrite.\nexport const SYNTX_64_SOURCE_PROMPT_RECORDS = Object.freeze({\n'+Object.entries(records).map(([id,r])=>`  ${JSON.stringify(id)}: ${JSON.stringify(r)}`).join(',\n')+'\n});\n');
write('app/veyrnox/_lib/sourceTemplateExpansion15.js', '// Generated by scripts/import-syntx-64-exact.mjs; exact prompts join at registration.\nexport const SYNTX_64_TEMPLATES = Object.freeze([\n'+recipes.map(r=>'  '+JSON.stringify(r)).join(',\n')+'\n]);\nexport const SYNTX_64_SHOWCASE_CLIPS = Object.fromEntries(SYNTX_64_TEMPLATES.map(t => [t.id, {\n  video: `/showcase/creator-${t.id}.mp4`, poster: `/showcase/creator-${t.id}.jpg`, aspectRatio: t.previewAspect, title: t.name.toLowerCase().replace(/(^|\\s)\\S/g, letter => letter.toUpperCase()),\n}]));\n');
write('tests/fixtures/syntx64PromptHashes.json', JSON.stringify(Object.fromEntries(audit.map(m=>[m.id,m.sourcePromptSha256])), null, 2)+'\n');
write(auditPath, JSON.stringify({ source: 'Syntx Trends', api: 'https://api.syntx.ai/api/v1/trends', auditedAt: '2026-11-05', requested: 64, accepted: audit.length, rejected,
  ...(visualSignatureMethod ? { visualSignatureMethod } : {}), manifestSha256: sha(read('manifest.json')), encodeReportSha256: sha(read('encode-report.json')), rejectionCounts: { 'content screen: blocked term': 7, 'no usable video variant under 40 MiB': 1 }, publicPromptHygiene: publicPromptHygiene(audit), 'source-reference-gaps': sourceReferenceGaps(audit), records: audit, 'ending-review': sourcePromptEndingReview(audit) }, null, 2)+'\n');
console.log(`Imported ${audit.length} exact pairs; ${audit.reduce((sum,r)=>sum+r.localPreviewBytes+r.localPosterBytes,0)} shipped bytes; all supplied hashes verified.`);
const showcasePath = resolve(root, 'docs/product/showcase-clips.md');
const marker = '<!-- BEGIN SYNTX 64 EXACT -->';
const previousShowcase = readFileSync(showcasePath, 'utf8');
const endMarker = '<!-- END SYNTX 64 EXACT -->';
const existingShowcase = previousShowcase.split(marker)[0].trimEnd();
const trailingShowcase = previousShowcase.includes(endMarker) ? previousShowcase.slice(previousShowcase.indexOf(endMarker) + endMarker.length) : '\n';
const table = audit.map(r => `| \`${r.id}\` | ${r.sourceTitle.trim().replaceAll('|', '\\|')} | [Syntx Trends](${r.sourceMediaUrl}) | 0 s |`).join('\n');
write(showcasePath, `${existingShowcase}\n\n${marker}\n## 5 November 2026: 63 exact Syntx pairs (one rejected)\n\nGenerated offline from the frozen manifest. Prepared preview and poster hashes\nare verified before copying. Source settings and model labels are locked in\n[source-audit/syntx-64-exact-2026-11-05.json](source-audit/syntx-64-exact-2026-11-05.json).\n\n| Tile | Original preview | Source asset | Start |\n| --- | --- | --- | --- |\n${table}\n<!-- END SYNTX 64 EXACT -->${trailingShowcase}`);

// The source identifiers below are provenance, never runtime legacy aliases.
const auditDocPath = resolve(root, 'docs/product/syntx-template-prompt-audit-2026-10-29.md');
const doc = readFileSync(auditDocPath, 'utf8');
const start = doc.indexOf('## Renamed source entries');
const end = doc.indexOf('## Earlier completion matrix', start);
assert.ok(start >= 0 && end > start);
const historic = ['event-character-swap', 'rap-takeover', 'curtain-reveal', 'character-takeover', 'escalator-loop', 'blood-moon-dance', 'red-thread-story', 'meal-together', 'sheep-kingdom', 'fashion-catch'];
const tableRows = historic.map(id => {
  const source = SYNTX_SOURCE_PROMPT_RECORDS[id];
  return `| \`${id}\` — ${SOURCE_TEMPLATES.find(t => t.id === id).name} | \`${source.sourceSlug || id}\` — ${source.sourceTitle} |`;
});
for (const row of audit.filter(r => PUBLIC_IDS[r.sourceSlug])) {
  tableRows.push(`| \`${row.id}\` — ${row.name} | \`${row.sourceSlug}\` — ${row.sourceTitle.trim()} |`);
}
const section = '## Renamed source entries\n\nNeutral public IDs and names are separate from source slugs and titles. The eleven new IDs have no redirect or legacy mapping.\n\n| Public id / name | Source slug / title |\n| --- | --- |\n' + tableRows.join('\n') + '\n\n';
write(auditDocPath, doc.slice(0, start) + section + doc.slice(end));
