import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_SWAP_CLIPS } from '../app/veyrnox/_lib/templateSwapClips.js';
import { TEMPLATE_SWAP_CLIP_SOURCES } from '../lib/templateSwapClipSources.js';
import { templateContract } from '../lib/templateContract.js';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
test('ships empty and dark; every existing swap remains blocked', () => {
 assert.deepEqual(TEMPLATE_SWAP_CLIPS, []); assert.ok(Object.isFrozen(TEMPLATE_SWAP_CLIPS));
 assert.deepEqual(TEMPLATE_SWAP_CLIP_SOURCES, {}); assert.ok(Object.isFrozen(TEMPLATE_SWAP_CLIP_SOURCES));
 assert.doesNotMatch(fs.readFileSync('wrangler.jsonc', 'utf8'), /TEMPLATE_SWAP_CLIP_ENABLED/);
 const ids = Object.values(JSON.parse(fs.readFileSync('lib/publicTemplateIds.json'))).flat();
 let count = 0;
 for (const id of ids) {
  const c = templateContract(id);
  if (!c || c.class === 'blocked-needs-video' || !swapNeedsSourceVideo(c.sourcePrompt)) continue;
  count++; assert.equal(checkTemplateRequest({ template_id: id, model_id: 'kling-o1-reference', inputs: {} }).error, 'template_blocked');
 }
 assert.equal(count, 127);
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
