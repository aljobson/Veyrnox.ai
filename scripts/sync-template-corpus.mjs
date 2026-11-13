// Recompute current prose counts from the registry; historical capture counts stay frozen.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { PRESETS, ALL_TEMPLATES, WALL_PRESETS, templatesIn } from '../app/veyrnox/_lib/templates.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { sourcePromptEndingReview } from './lib/source-prompt-endings.mjs';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const fill = JSON.parse(readFileSync('docs/product/source-audit/higgsfield-category-fill-30-2026-11-05.json'));
const expansion = JSON.parse(readFileSync('docs/product/source-audit/higgsfield-300-exact-2026-11-05.json'));
const audits = PRESETS.map(t => sourcePromptAuditRecord(t.id));
const n = {
  retained: SOURCE_TEMPLATES.length, public: PRESETS.length, all: ALL_TEMPLATES.length,
  captured: SOURCE_TEMPLATES.filter(t => exactSourcePromptRecord(t.id)).length,
  hidden: SOURCE_TEMPLATES.length - PRESETS.length, wall: WALL_PRESETS.length,
  compatible: audits.filter(a => a.runnable).length, incompatible: audits.filter(a => !a.runnable).length,
  slots: PRESETS.filter(t => /@(?:image|video)\s*[_-]?\d+|<<<\s*(?:image|video)[_\s-]*\d+\s*>>>/i.test(t.prompt)).length,
  references: audits.filter(a => a.referenceImageCount || a.referenceVideoCount).length,
  images: audits.filter(a => a.referenceImageCount).length, multi: audits.filter(a => a.referenceImageCount > 1).length,
  many: audits.filter(a => a.referenceImageCount > 2).length, videos: audits.filter(a => a.referenceVideoCount).length,
  audio: audits.filter(a => a.issues.includes('audio-preservation-not-supported')).length,
  placements: Object.keys(AUDIT_SHOWCASE_CLIPS).length,
};
const syntx = JSON.parse(readFileSync('docs/product/source-audit/syntx-64-exact-2026-11-05.json'));
const syntxBytes = syntx.records.reduce((sum, r) => sum + r.localPreviewBytes + r.localPosterBytes, 0);
const longest = PRESETS.toSorted((a, b) => b.prompt.length - a.prompt.length)[0];
const comma = value => value.toLocaleString('en-US');
const common = text => text.replace(/all \d+ retained placements/g, 'all ' + n.placements + ' retained placements')
  .replace(/All \d+ retained placements/g, 'All ' + n.placements + ' retained placements');
const update = (file, transform) => {
  const before = readFileSync(file, 'utf8'), after = transform(before);
  if (process.argv.includes('--check')) assert.equal(before, after, file + ': run node scripts/sync-template-corpus.mjs');
  else if (after !== before) writeFileSync(file, after);
};
update('docs/product/template-prompt-audit-2026-10-29.md', text => {
  text = common(text).replace(/Exact-only plus (?:Syntx 64|category fill) \|/, 'Exact-only plus replacements |');
  for (const [label, value] of Object.entries({
    'Retained community templates': n.retained, 'Captured source texts, including one truncated record': n.captured,
    'Public community gallery': n.public, 'Public complete exact prompts': n.public, 'Hidden community rows': n.hidden,
    'All addressable recipes including independent catalogs': comma(n.all), 'Homepage wall templates': n.wall,
  })) text = text.replace(new RegExp('(\\| ' + label + ' \\| [^|]+\\|) [^|]+\\|'), '$1 ' + value + ' |');
  text = text.replace(/Audit-compatible: \*\*\d+\*\*; incompatible: \*\*\d+\*\*\./, 'Audit-compatible: **' + n.compatible + '**; incompatible: **' + n.incompatible + '**.');
  for (const [prefix, value] of [['Explicit numbered slot tokens', n.slots], ['Image/video reference requirement', n.references],
    ['Any image reference', n.images], ['More than one image reference', n.multi], ['More than two image references', n.many],
    ['Video reference', n.videos], ['Audio/music/voice/dialogue/lip-sync mention', n.audio]]) {
    text = text.replace(new RegExp('(\\| ' + prefix + '[^|]+\\|) \\d+ \\|'), '$1 ' + value + ' |');
  }
  text = text.replace(/\) adds \d+\nsame-record prompts, [\d,]+ prepared media files and [\d,]+ shipped bytes\./,
    ') adds ' + syntx.accepted + '\nsame-record prompts, ' + syntx.accepted * 2 + ' prepared media files and ' + comma(syntxBytes) + ' shipped bytes.');
  text = text.replace(/record remains [^\n]+ characters\)\./, 'record is ' + longest.name + ' (' + comma(longest.prompt.length) + ' characters).');
  text = text.replace(/The \d+ new audit rows declare/, 'The ' + syntx.accepted + ' accepted new audit rows declare');
  text = text.replace(/\d+ immutable same-record prompt\/video pairs and \d+ prepared assets\n\([\d,]+ bytes\)/,
    expansion.accepted + ' immutable same-record prompt/video pairs and ' + expansion.accepted * 2 + ' prepared assets\n(' + comma(expansion.addedBytes) + ' bytes)');
  text = text.replace(/Its \d+ compatible \/ \d+ incompatible flags/, 'Its ' + expansion.compatibility.compatible + ' compatible / ' + expansion.compatibility.incompatible + ' incompatible flags');
  return text;
});
update('docs/product/template-recipes.md', text => common(text)
  .replace(/The 300-record stage adds \d+ prepared assets and keeps \d+ compatible \/ \d+/, 'The 300-record stage retains ' + expansion.accepted + ' pairs, ' + expansion.accepted * 2 + ' prepared assets and ' + expansion.compatibility.compatible + ' compatible / ' + expansion.compatibility.incompatible)
  .replace(/The 300-record stage retains \d+ pairs, \d+ prepared assets and \d+ compatible \/ \d+/, 'The 300-record stage retains ' + expansion.accepted + ' pairs, ' + expansion.accepted * 2 + ' prepared assets and ' + expansion.compatibility.compatible + ' compatible / ' + expansion.compatibility.incompatible)
  .replace(/Amendment 1 adds \d+ accepted/, 'Amendment 1 adds ' + fill.accepted + ' accepted')
  .replace(/the rejected incomplete records?\b/, 'the rejected incomplete records')
  .replace(/The Syntx 64 adds [\s\S]*?Source model\/version labels remain separate from routing\./,
    'The prepared Syntx batch publishes ' + syntx.accepted + ' exact prompts and ' + syntx.accepted * 2 + ' prepared assets.\nCompatibility-first Seedance guidance routes all accepted rows to Fast;\nsource model/version labels remain separate from routing. Dark Couture is rejected.')
  .replace(/registry retains \d+ rows and publishes \d+ complete exact/, 'registry retains ' + n.retained + ' rows and publishes ' + n.public + ' complete exact')
  .replace(/has [\d,]+ addressable recipes/, 'has ' + comma(n.all) + ' addressable recipes')
  .replace(/decision: \d+ public exact\nprompts are compatible and \d+ incompatible/, 'decision: ' + n.compatible + ' public exact\nprompts are compatible and ' + n.incompatible + ' incompatible')
  .replace(/\d+ contain explicit numbered reference slots/, n.slots + ' contain explicit numbered reference slots')
  .replace(/audit counts \d+ prompts with image\/video requirements/, 'audit counts ' + n.references + ' prompts with image/video requirements'));
update('docs/product/showcase-clips.md', text => common(text)
  .replace(/## (?:300 additional|\d+ of 300 retained) exact community pairs/, '## ' + expansion.accepted + ' of 300 retained exact community pairs')
  .replace(/The \d+ supplied encodes\/posters were copied/, 'The ' + expansion.accepted * 2 + ' retained encodes/posters were copied')
  .replace(/The \d+ retained encodes\/posters were copied/, 'The ' + expansion.accepted * 2 + ' retained encodes/posters were copied')
  .replace(/Added bytes: \*\*[\d,]+\*\* \([\d.]+ MiB\)/, 'Added bytes: **' + comma(expansion.addedBytes) + '** (' + (expansion.addedBytes / 1024 / 1024).toFixed(1) + ' MiB)')
  .replace(/exact-only update and (?:Syntx \d+|\d+ accepted Syntx rows) brought (?:the corpus|the pre-amendment corpus) to \d+, with \d+ public and 70 hidden\./, 'exact-only update and ' + syntx.accepted + ' accepted Syntx rows brought the pre-amendment corpus to ' + (737 + syntx.accepted) + ', with ' + (667 + syntx.accepted) + ' public and 70 hidden.')
  .replace(/pre-amendment corpus of \d+/g, 'pre-amendment corpus of ' + (437 + 300 + syntx.accepted))
  .replace(/current public gallery has \d+ exact/, 'current public gallery has ' + n.public + ' exact')
  .replace(/checks cover all \d+ retained source templates/, 'checks cover all ' + n.retained + ' retained source templates'));
update('docs/adr/0325-exact-only-community-templates.md', text => common(text)
  .replace(/category batch contributes \d+: [\s\S]*?KIDS\nBIRTHDAY/, 'category batch contributes ' + fill.accepted + ': two\nincomplete prompts are rejected without rewriting them (mid-word truncation and missing replacement slots). KIDS\nBIRTHDAY')
  .replace(/70 hidden rows, \d+ retained community rows, \d+ public exact templates/, '70 hidden rows, ' + n.retained + ' retained community rows, ' + n.public + ' public exact templates')
  .replace(/decision: \d+ public templates\nare audit-compatible and \d+ incompatible/, 'decision: ' + n.compatible + ' public templates\nare audit-compatible and ' + n.incompatible + ' incompatible')
  .replace(/There are \d+ prompts with explicit/, 'There are ' + n.slots + ' prompts with explicit')
  .replace(/slots, and \d+ with reference requirements/, 'slots, and ' + n.references + ' with reference requirements'));

const required = ['YOUR PHOTO', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'];
const begin = '<!-- BEGIN CATEGORY MINIMUM COUNTS -->', end = '<!-- END CATEGORY MINIMUM COUNTS -->';
const section = begin + '\n## Amendment 1: at least ten exact templates per content category\n\n' +
  fill.accepted + ' of ' + fill.requested + ' prepared same-record pairs are published, adding ' + comma(fill.addedBytes) + ' bytes in ' + (fill.accepted * 2) + ' unchanged prepared files.\n' +
  'Archery Face Swap was dropped because its source text ends mid-word; Anime Court Match was dropped because both replacement subjects were stripped from an incomplete fragment. Only identifiers, hashes and reasons are retained for these rejections; no prompt or media is shipped.\n' +
  'The source categories follow the manifest except Cartoon Hero Swap, corrected from ANIME to CARTOONS after inspection. The existing Kling I2V route, price and ten-second recipe duration apply; source input totals and numbered tokens select existing starting-image guidance without changing reference support.\n\n' +
  '| Content category | Public exact templates |\n| --- | ---: |\n' +
  required.map(c => '| ' + c + ' | ' + PRESETS.filter((p) => c === 'ALL' || (c === 'NEW' ? p.isNew : p.category === c)).length + ' |').join('\n') +
  '\n\nKIDS BIRTHDAY is explicitly excluded pending an owner decision: its twelve promptless rows remain retained and hidden, zero are public, and the category is absent from the gallery filter. It remains in CATEGORY_ORDER.\n' +
  'The [category-fill audit](source-audit/higgsfield-category-fill-30-2026-11-05.json) and fixed-list regression tests lock this state.\n' + end;
update('docs/product/template-prompt-audit-2026-10-29.md', text => text.includes(begin)
  ? text.slice(0, text.indexOf(begin)) + section + text.slice(text.indexOf(end) + end.length)
  : text.trimEnd() + '\n\n' + section + '\n');
console.log(JSON.stringify(n));

const rejectBegin = '<!-- BEGIN CLIPPED SOURCE REVIEW -->', rejectEnd = '<!-- END CLIPPED SOURCE REVIEW -->';
const replacements = ['higgsfield-replacements-12', 'syntx-replacements-4'].map(name => JSON.parse(readFileSync('docs/product/source-audit/' + name + '-2026-11-07.json')));
const endingReviews = [expansion, fill, syntx, ...replacements].map(a => sourcePromptEndingReview(a.records));
const ambiguousCount = endingReviews.reduce((sum, review) => sum + review.ambiguousUnpunctuatedCount, 0);
const reviewedCount = endingReviews.reduce((sum, review) => sum + review.reviewedAmbiguousCount, 0);
const notableEndings = endingReviews.flatMap(review => review.inventory)
  .filter(r => r.status === 'ambiguous' && (r.kind === 'connector' || r.kind === 'reviewed'));
const tableText = text => text.replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('|', '\\|').replaceAll('`', '\\`');
const rejectionSection = rejectBegin + '\nThe final ending review rejected ' +
  expansion.rejected.map(r => '`' + r.id + '`: ' + r.reason).join(' ') +
  ' Only audit identifiers, hashes and reasons remain; the rejected records, recipes, clips, media and active fixtures were removed. The 300-record capture now retains ' + expansion.accepted + ' pairs. Historical stage-1 counts above describe the earlier snapshot.\n\n' +
  'The detector reports ' + ambiguousCount + ' ambiguous unpunctuated endings, plus ' + reviewedCount + ' separately reviewed ambiguity. These rows remain published. A trailing connector without an origin-gap pattern stays ambiguous; a connector alone never auto-rejects or hides a row. Origin-stripped connectors remain under the source-reference-gaps policy. The complete id/reason/tail inventories are generated in the five audit JSONs under `ending-review`.\n\n' +
  'Connector endings and separately reviewed ambiguities are listed below. Tails contain the last 80 characters (or the whole prompt if shorter); `\\r` and `\\n` represent captured line endings.\n\n' +
  '| Public id | Reason | Final 80 characters |\n| --- | --- | --- |\n' +
  notableEndings.map(r => '| `' + r.id + '` | ' + tableText(r.reason) + ' | `' + tableText(r.tail) + '` |').join('\n') + '\n' + rejectEnd;
for (const path of ['docs/product/template-prompt-audit-2026-10-29.md', 'docs/adr/0325-exact-only-community-templates.md']) {
  update(path, text => text.includes(rejectBegin)
    ? text.slice(0, text.indexOf(rejectBegin)) + rejectionSection + text.slice(text.indexOf(rejectEnd) + rejectEnd.length)
    : text.trimEnd() + '\n\n' + rejectionSection + '\n');
}
