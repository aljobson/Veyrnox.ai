import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import ts from 'typescript';
import data from '../lib/templateFidelityContracts.json' with { type: 'json' };
import routes from '../lib/templateRoutes.json' with { type: 'json' };
import { packTemplateRoutes } from '../scripts/template-route-data.mjs';
import { templateContract as fullContract } from '../lib/templateContract.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { checkTemplateChunks, TEMPLATE_CHUNK_BUDGET } from '../scripts/check-template-bundle.mjs';
import { capabilityFor, checkSource } from '../lib/modelCapabilities.js';

const roots = ['app/veyrnox/_lib/tokens.js', 'lib/publicPresets.js', 'lib/clientTemplates.js',
  'apps/mobile/src/lib/presets.ts', 'app/veyrnox/_components/UseTemplate.js',
  'app/veyrnox/app/create/page.js', 'apps/mobile/src/lib/templateFidelity.ts'];
function graph(root) {
  const visited = new Set(), imports = new Set();
  function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    if (extname(file) === '.json') return;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.getText(source) === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) ? node.arguments[0] : null;
      if (specifier && ts.isStringLiteral(specifier)) {
        const spec = specifier.text;
        imports.add(spec);
        if (spec.startsWith('.')) {
          const base = resolve(dirname(file), spec);
          const path = [base, ...['.js', '.jsx', '.ts', '.tsx', '.mjs', '.json', '/index.js', '/index.ts'].map(ext => base + ext)].find(p => existsSync(p) && extname(p));
          assert.ok(path, `unresolved import ${spec} in ${file}`);
          walk(path);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  walk(resolve(root));
  return { visited, imports };
}
test('route map is generated from the unchanged contract and stays under 60 KiB', () => {
  assert.ok(readFileSync('lib/templateRoutes.json').byteLength < 60 * 1024);
  assert.deepEqual(routes, packTemplateRoutes(data.templates));
  assert.doesNotMatch(JSON.stringify(routes), /sourcePromptIndex|tokenMap|sourceHash|boundHash|reasons/);
});
test('routing, discovery and client entry graphs cannot import the full table or SSR-forbidden packages', () => {
  for (const root of roots) {
    const { visited, imports } = graph(root);
    assert.ok(![...visited].some(p => p.endsWith('/templateFidelityContracts.json')), root);
    for (const path of visited) if (/\.(?:js|mjs|jsx)$/.test(path)) assert.ok(!readFileSync(path, 'utf8').includes('sourcePromptIndex'), `${root}: ${path} exposes full-contract expansion`);
    assert.ok(![...imports].some(p => /^(jose|tsx|@supabase\/supabase-js)(\/|$)/.test(p)), root);
  }
});
test('all 771 detail payloads reproduce only the UI fields of their original contracts', () => {
  for (const id of Object.keys(data.templates)) {
    const full = fullContract(id), ui = templateDetail(id).fidelity;
    assert.ok(ui, id);
    for (const key of ['class', 'modelId', 'sourcePrompt', 'prompt', 'allowedModels', 'aspect', 'duration', 'negativePrompt', 'negativeMax', 'requiredReferences', 'tokenMap', 'photoGuidance', 'minPhotoDimension']) assert.deepEqual(ui[key], full[key], `${id}: ${key}`);
    assert.equal(ui.slotCount, full.slotCount || 0);
    assert.ok(!('sourcePromptIndex' in ui) && !('sourceHash' in ui));
  }
});
test('every bound contract requires exactly its slot count, independently of min/max drift', () => {
  for (const c of Object.values(data.templates).filter(c => c.class === 'bound')) {
    assert.equal(c.requiredReferences.imageMin, c.slotCount, c.id);
    assert.equal(c.requiredReferences.imageMax, c.slotCount, c.id);
  }
  const c = Object.values(data.templates).find(c => c.class === 'bound' && c.slotCount > 1);
  const original = c.requiredReferences;
  c.requiredReferences = { ...original, imageMin: 0, imageMax: 9 };
  try {
    const full = fullContract(c.id);
    const request = { template_id: c.id, model_id: c.modelId, inputs: { prompt: full.prompt, aspect_ratio: c.aspect, duration_seconds: c.duration, negative_prompt: c.negativePrompt } };
    for (const count of [0, c.slotCount - 1, c.slotCount + 1]) assert.equal(checkTemplateRequest({ ...request, references: Array.from({ length: count }, (_, i) => ({ slot: 'image', origin: 'upload', key: `uploads/${i}.png` })) }).error, 'template_references_invalid');
  } finally { c.requiredReferences = original; }
});
test('server capability decides unknown dimensions; Seedance reference has no 256px contract floor', () => {
  const cap = capabilityFor('bytedance/seedance-2.0/reference-to-video');
  assert.equal(cap.media.image.minSide, undefined);
  for (const dimensions of [null, { width: 0, height: 0 }, { width: 255, height: 255 }, { width: 256, height: 256 }]) {
    assert.deepEqual(checkSource(cap, { image_url: { dimensions } }), { ok: true });
  }
});
test('build guard rejects full-table markers and template-bearing chunks over 1 MB', () => {
  const dir = '.gstack/a2-round4/bundle-guard-fixture';
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(`${dir}/safe.js`, 'const route = "boundModelId";');
    assert.equal(checkTemplateChunks(dir).failures.length, 0);
    writeFileSync(`${dir}/full.js`, 'sourcePromptIndex');
    assert.equal(checkTemplateChunks(dir).failures.length, 1);
    rmSync(`${dir}/full.js`);
    writeFileSync(`${dir}/large.js`, 'tokenMap' + ' '.repeat(TEMPLATE_CHUNK_BUDGET));
    assert.equal(checkTemplateChunks(dir).failures.length, 1);
  } finally { rmSync(dir, { recursive: true }); }
});
