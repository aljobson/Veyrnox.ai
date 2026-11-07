import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { register } from 'node:module';
import { SWAP_SCENES, publicSwapScene } from '../app/veyrnox/_lib/swapScenes.js';
import { SWAP_SCENE_SOURCES } from '../lib/swapSceneSources.js';
import { swapSceneAvailable, loadSwapScene } from '../lib/swapSceneGate.js';
import { scenes, manifest, catalog } from './fixtures/swapScenes.mjs';
import { ALL_TEMPLATES, PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateCards, templateDetail, searchTemplateIds } from '../lib/clientTemplates.js';
import { templateStartId } from '../lib/templateStart.js';
import { resolveSwapVideo } from '../lib/swapSceneGeneration.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { sweepConsumedUploads } from '../lib/uploadSweep.js';
const env = { APP_ENV: 'staging' };
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shipped registry and manifest are empty; no ID is published in any environment', () => {
  assert.deepEqual(SWAP_SCENES, []); assert.deepEqual(SWAP_SCENE_SOURCES, {});
  for (const APP_ENV of ['production', 'staging', undefined]) for (const id of [...scenes.map(s => s.id), 'unknown', '__proto__']) {
    assert.equal(swapSceneAvailable(id, { env: { APP_ENV }, catalog }), false);
    assert.equal(swapSceneAvailable(id, { env: { APP_ENV }, catalog, scenes }), false);
  }
});
test('single publication gate fails closed, including effective two-person limit and missing catalog evidence', async () => {
  for (const MULTI_REFERENCE_ENABLED of [undefined, 'false', 'true']) {
    for (const scene of scenes) {
      const options = { env: { ...env, MULTI_REFERENCE_ENABLED }, catalog, scenes, manifest };
      const expected = scene.people === 1 || MULTI_REFERENCE_ENABLED === 'true';
      assert.equal(swapSceneAvailable(scene.id, options), expected);
      assert.equal(!!await loadSwapScene(scene.id, {}, { ...options, read: async () => catalog }), expected);
      for (const override of [{ catalog: [] }, { catalog: null }, { manifest: {} }, { env: { APP_ENV: 'production', MULTI_REFERENCE_ENABLED: 'true' } }, { catalog: catalog.map(r => ({ ...r, active: false })) }]) {
        assert.equal(swapSceneAvailable(scene.id, { ...options, ...override }), false);
      }
    }
  }
  assert.equal(await loadSwapScene(scenes[0].id, {}, { env, scenes, manifest, read: async () => { throw Error('offline'); } }), null);
});
test('public serializers cannot carry server source fields; templates, presets, search and attribution stay separate', async () => {
  const poisoned = scenes.map(scene => ({ ...scene, ...manifest[scene.id], video_url: 'https://secret.test/signed' }));
  const fields = ['id','name','category','aspect','needs','swapOffer','people','model','credits','durationSeconds'];
  for (const scene of scenes) {
    const view = publicSwapScene(scene.id, poisoned);
    assert.deepEqual(Object.keys(view), fields);
    assert.doesNotMatch(JSON.stringify(view), /sha256|swap-scenes\/|video_url|secret\.test/);
    const loaded = await loadSwapScene(scene.id, {}, { env: { ...env, MULTI_REFERENCE_ENABLED: 'true' }, scenes: poisoned, manifest, read: async () => catalog });
    assert.deepEqual(Object.keys(loaded.scene), fields);
    assert.equal(templateDetail(scene.id), null);
    assert.equal(templateStartId(scene.id, scene.swapOffer), null);
    assert.ok(!searchTemplateIds(scene.id).includes(scene.id));
  }
  assert.equal(ALL_TEMPLATES.length, 1813); assert.equal(PRESETS.length, 771); assert.equal(templateCards().length, 771);
  for (const template of ALL_TEMPLATES) {
    assert.ok(!Object.hasOwn(template, 'template_source')); assert.ok(!Object.hasOwn(template, 'sha256'));
  }
  // The recipe serializer spreads only templateById, whose catalog remains independent.
  assert.match(read('app/veyrnox/presets/[id]/page.js'), /const template = templateById\(id\)/);
  assert.doesNotMatch(read('app/veyrnox/presets/[id]/page.js'), /swapScene/);
});
test('both duration facts are preserved, bounded independently, and signed for at most fifteen minutes', async () => {
  const scene = scenes[0], source = manifest[scene.id], record = capabilityFor(catalog[0].provider_endpoint);
  for (const [override, error] of [[{ seconds: undefined }, 'source_length_unknown'], [{ seconds: 11, videoSeconds: 7 }, 'source_too_long'], [{ videoSeconds: undefined }, 'source_length_unknown'], [{}, undefined]]) {
    let signed = false;
    const result = await resolveSwapVideo({ scene, source: { ...source, ...override } }, record, {}, async (key, ttl) => {
      signed = true; assert.equal(key, source.key); assert.equal(ttl, 900); return { url: 'https://signed.test/clip' };
    });
    assert.equal(result.error, error); assert.equal(signed, !error);
    if (!error) assert.deepEqual(result.metadata, { seconds: 7, videoSeconds: 7, dimensions: { width: 640, height: 360 }, contentType: 'video/mp4' });
  }
});
test('consumed upload sweep never removes shared scene media', async () => {
  const key = 'uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';
  const removed = [], source = manifest[scenes[0].id];
  await sweepConsumedUploads({}, {}, { find: async () => [{ id: 'job', inputs: { template_source: { scene: scenes[0].id, version: source.version, sha256: source.sha256 }, references: [{ origin: 'upload', slot: 'image', key }], source_keys: { video_url: source.key } } }], remove: async k => { removed.push(k); return { ok: true }; } });
  assert.deepEqual(removed, [key]);
});
test('server source manifest is unreachable from every client entry import graph', () => {
  const root = resolve('.'), files = [];
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const path = resolve(dir, item.name);
      if (item.isDirectory()) walk(path); else if (/\.[cm]?[jt]sx?$/.test(path)) files.push(path);
    }
  }
  for (const dir of ['app','lib','components','apps/mobile/src']) walk(resolve(dir));
  const imports = path => [...readFileSync(path, 'utf8').matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]).flatMap(spec => {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) return [];
    const base = spec.startsWith('@/') ? resolve(root, spec.slice(2)) : resolve(dirname(path), spec);
    return [base, ...['.js','.mjs','.jsx','.ts','.tsx','/index.js','/index.ts'].map(ext => base + ext)].filter(p => existsSync(p) && files.includes(p)).slice(0, 1);
  });
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return; visited.add(path);
    assert.notEqual(relative(root, path), 'lib/swapSceneSources.js', path);
    for (const dep of imports(path)) visit(dep);
  }
  for (const file of files) if (/^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')) || file.includes('/apps/mobile/src/')) visit(file);
});

test('shipped catalog scene lookup returns not-found without reading catalog or media', async t => {
  register('data:text/javascript,' + encodeURIComponent("export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }"));
  const { GET } = await import('../app/api/catalog/route.js');
  const previous = process.env.APP_ENV;
  t.after(() => { if (previous === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previous; });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('an empty manifest/catalog registry needs no network'); });
  for (const environment of ['production', 'staging']) {
    process.env.APP_ENV = environment;
    const res = await GET(new Request('https://fixture.test/api/catalog?swap=x', { headers: { 'x-veyrnox-auth-id': 'owner' } }));
    assert.equal(res.status, 404); assert.deepEqual(await res.json(), { error: 'swap_scene_not_found' });
  }
});
