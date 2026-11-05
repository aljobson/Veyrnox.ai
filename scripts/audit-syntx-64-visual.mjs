// Explicit lightweight ffprobe audit; no network, video encoding or build.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { visualSignature, VISUAL_SIGNATURE_METHOD } from './lib/source-visual-signature.mjs';
const values = {};
const expectedCount = Object.keys(AUDIT_SHOWCASE_CLIPS).length;
for (const [id, clip] of Object.entries(AUDIT_SHOWCASE_CLIPS)) {
  const file = `public${clip.video.replace(/-(?:higgs|syntx)-/, '-')}`;
  values[id] = visualSignature(file);
  if (Object.keys(values).length % 100 === 0) console.log(`Checked ${Object.keys(values).length} normalized previews`);
}
assert.equal(Object.keys(values).length, expectedCount);
assert.equal(new Set(Object.values(values).map(v => v.signature)).size, expectedCount, 'visual duplicate');
const fixture = { method: VISUAL_SIGNATURE_METHOD, placements: values };
const fixturePath = 'tests/fixtures/exactOnlyVisualSignatures.json';
if (process.argv.includes('--check')) {
  assert.deepEqual(JSON.parse(readFileSync(fixturePath)), fixture);
} else {
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2)+'\n');
  for (const name of ['syntx-64-exact-2026-11-05', 'higgsfield-category-fill-30-2026-11-05']) {
  const auditPath = 'docs/product/source-audit/' + name + '.json';
  const audit = JSON.parse(readFileSync(auditPath));
  audit.visualSignatureMethod = VISUAL_SIGNATURE_METHOD;
  for (const r of audit.records) { r.sourceVideoSignature = values[r.id].signature; r.signatureFrameCount = values[r.id].frames; }
  writeFileSync(auditPath, JSON.stringify(audit, null, 2)+'\n');
  }
}
console.log(`Verified ${expectedCount} distinct normalized visual signatures; no video encoded.`);
