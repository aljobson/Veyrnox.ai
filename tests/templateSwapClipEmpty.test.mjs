import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_SWAP_CLIPS, TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 } from '../app/veyrnox/_lib/templateSwapClips.js';
import { templateContract } from '../lib/templateContract.js';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
test('ships ids and a pin but stays dark; every existing swap remains blocked', () => {
 assert.ok(Object.isFrozen(TEMPLATE_SWAP_CLIPS)); assert.equal(TEMPLATE_SWAP_CLIPS.length, 410);
 // The upload verified 411 clips; one near-duplicate stays in the R2 manifest only and is refused here.
 assert.equal(TEMPLATE_SWAP_CLIPS.includes('community-brand-billboard-swap'), false);
 assert.deepEqual([...TEMPLATE_SWAP_CLIPS], [...new Set(TEMPLATE_SWAP_CLIPS)].sort());
 assert.match(TEMPLATE_SWAP_CLIP_MANIFEST_SHA256, /^[0-9a-f]{64}$/);
 assert.equal(fs.existsSync('lib/templateSwapClipSources.js'), false);
 assert.doesNotMatch(fs.readFileSync('wrangler.jsonc', 'utf8'), /TEMPLATE_SWAP_CLIP_ENABLED|templateSwap/);
 const ids = Object.values(JSON.parse(fs.readFileSync('lib/publicTemplateIds.json'))).flat();
 let count = 0;
 for (const id of ids) {
  const c = templateContract(id);
  if (!c || c.class === 'blocked-needs-video' || !swapNeedsSourceVideo(c.sourcePrompt)) continue;
  count++; assert.equal(checkTemplateRequest({ template_id: id, model_id: 'kling-o1-reference', inputs: {} }).error, 'template_blocked');
 }
 assert.equal(count, 132); // 127 until the guard learned three more swap wordings (18 Nov 2026)
});
test('fidelity dependency graph never imports new swap clip modules', () => {
 const seen = new Set();
 function walk(file) {
  if (seen.has(file)) return; seen.add(file);
  const source = fs.readFileSync(file, 'utf8'); assert.doesNotMatch(source, /templateSwapClip/);
  for (const m of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
   if (m[1].startsWith('.')) { const next = path.resolve(path.dirname(file), m[1]); if (/\.(js|mjs)$/.test(next)) walk(next); }
  }
 }
 walk(path.resolve('lib/templateFidelity.js'));
});

test('the latest O1 catalog migration and fallback keep the offer inactive', async () => {
 const directory = 'packages/db/schema/supabase';
 const migrations = fs.readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()
  .map(name=>fs.readFileSync(path.join(directory,name),'utf8')).filter(sql=>sql.includes("'kling-o1-reference'"));
 assert.ok(migrations.length);
 assert.match(migrations.at(-1), /'video-to-video',47,0\.8400,'per_second',5,false,false/);
 assert.match(migrations.at(-1), /active=EXCLUDED\.active/);
 const { MODELS } = await import('../app/veyrnox/_lib/tokens.js');
 assert.equal(MODELS.find(row=>row.id==='kling-o1-reference').staged,true);
});

test('the gate stays free of the template-contract graph (it is imported by /api/catalog, a separate Worker bundle)', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../lib/templateSwapClipGate.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /templateContract|templateFidelity|templateSwapGuard/);
});

test('every id in the shipped registry is a template that needs a source clip (swap, video-blocked swap or motion)', async () => {
  const { TEMPLATE_SWAP_CLIPS } = await import('../app/veyrnox/_lib/templateSwapClips.js');
  const { swapCandidates } = await import('../scripts/import-template-swap-clips.mjs');
  const allowed = new Set((await swapCandidates()).map(c => c.id));
  for (const id of TEMPLATE_SWAP_CLIPS) assert.ok(allowed.has(id), id);
});

test('Worker budget follows the webpack production build decision (ADR-0353)', async () => {
 const { WORKER_SIZE_BUDGET_KIB } = await import('../scripts/check-worker-size.mjs');
 assert.equal(WORKER_SIZE_BUDGET_KIB, 48500);
});
