// Offline inventory only: no prompt or publication mutations.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { publicPromptHygiene } from './lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from './lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from './lib/source-prompt-endings.mjs';
const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const write = (path, value) => {
  const url = new URL(path, root), before = readFileSync(url, 'utf8');
  if (check) assert.equal(before, value, path + ': regenerate public prompt hygiene');
  else if (value !== before) writeFileSync(url, value);
};
const audits = ['higgsfield-300-exact', 'syntx-64-exact', 'higgsfield-category-fill-30', 'higgsfield-replacements-12', 'syntx-replacements-4'].map(name => {
  const path = 'docs/product/source-audit/' + name + (name.includes('replacements') ? '-2026-11-07.json' : '-2026-11-05.json');
  const audit = JSON.parse(readFileSync(new URL(path, root)));
  audit.publicPromptHygiene = publicPromptHygiene(audit.records);
  audit['source-reference-gaps'] = sourceReferenceGaps(audit.records);
  audit['ending-review'] = sourcePromptEndingReview(audit.records);
  write(path, JSON.stringify(audit, null, 2) + '\n');
  return {name, ...audit};
});
const begin = '<!-- BEGIN PUBLIC PROMPT HYGIENE -->', end = '<!-- END PUBLIC PROMPT HYGIENE -->';
const section = begin + '\nCaptured public text remains verbatim by owner decision, including third-party handles, plates, addresses, domains, promo codes and upload filenames. These are pattern-detected candidates, not verified identities. No redaction or publication change is applied. The shared offline scanner and regression test cover all ' + audits.map(a => a.records.length).join(' + ') + ' accepted raw prompts.\n\n| Capture | Affected public id | Detected kinds |\n| --- | --- | --- |\n' + audits.flatMap(a => a.publicPromptHygiene.inventory.map(r => '| ' + a.name + ' | `' + r.id + '` | ' + r.kinds.join(', ') + ' |')).join('\n') + '\n' + end;
for (const path of ['docs/product/template-prompt-audit-2026-10-29.md', 'docs/product/syntx-template-prompt-audit-2026-10-29.md', 'docs/adr/0325-exact-only-community-templates.md']) {
  const before = readFileSync(new URL(path, root), 'utf8');
  const after = before.includes(begin) ? before.slice(0, before.indexOf(begin)) + section + before.slice(before.indexOf(end) + end.length) : before.trimEnd() + '\n\n' + section + '\n';
  write(path, after);
}
console.log(JSON.stringify(audits.map(a => ({capture:a.name, scanned:a.records.length, inventory:a.publicPromptHygiene.inventory}))));

const gapBegin = '<!-- BEGIN SOURCE REFERENCE GAPS -->', gapEnd = '<!-- END SOURCE REFERENCE GAPS -->';
const total = audits.reduce((sum, a) => sum + a['source-reference-gaps'].count, 0);
const gaps = gapBegin + '\n## source-reference-gaps (informational)\n\n' + total +
  ' retained rows across the five captures are exact as published but incomplete by origin: source feeds delete reference mentions. The owner may hide them. Their captured bytes, publication and `sourcePromptRunnable` flags remain unchanged. Input-asset counts corroborate missing mentions where the capture records them; Syntx does not supply that count in this audit. The detector uses grammatical gaps, not upload counts alone, and does not guarantee detection of every missing mention.\n\n' +
  '| Capture | Affected public id | Detected gaps | Captured input assets |\n| --- | --- | --- | ---: |\n' +
  audits.flatMap(a => a['source-reference-gaps'].inventory.map(r => '| ' + a.name + ' | `' + r.id + '` | ' + r.kinds.join(', ') + ' | ' + (r.inputAssetCount ?? 'not recorded') + ' |')).join('\n') + '\n' + gapEnd;
for (const path of ['docs/product/template-prompt-audit-2026-10-29.md', 'docs/product/syntx-template-prompt-audit-2026-10-29.md', 'docs/adr/0325-exact-only-community-templates.md']) {
  const before = readFileSync(new URL(path, root), 'utf8');
  write(path, before.includes(gapBegin) ? before.slice(0, before.indexOf(gapBegin)) + gaps + before.slice(before.indexOf(gapEnd) + gapEnd.length) : before.trimEnd() + '\n\n' + gaps + '\n');
}
console.log(JSON.stringify({ sourceReferenceGaps: total, captures: audits.map(a => ({ capture: a.name, ...a['source-reference-gaps'] })) }));
