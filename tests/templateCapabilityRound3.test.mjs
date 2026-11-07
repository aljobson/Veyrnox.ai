import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import ts from 'typescript';
import { fixture } from './helpers/publicSiteRender.mjs';
import { templateContract, templatePhotosUnavailable } from '../lib/templateContract.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';
const contract = PRESETS.map(p => templateContract(p.id)).find(c => c?.class === 'bound' && c.slotCount === 3);
const preset = PRESETS.find(p => p.id === contract.id);
const paths = ['app/veyrnox/_components/UseTemplate.js', 'app/veyrnox/app/create/page.js', 'apps/mobile/src/app/(app)/templates/[id].tsx', 'apps/mobile/src/app/(app)/create/[modelId].tsx'];
function expression(path, name) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer.getText(source); ts.forEachChild(node, visit); }; visit(source);
  assert.ok(found, `${path}: ${name}`);
  return found;
}
for (const flag of ['false', 'true']) test(`live capability gates web and mobile template/Create before uploads, flag=${flag}`, async t => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  process.env.MULTI_REFERENCE_ENABLED = flag;
  t.after(() => { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; });
  const cap = publicCapabilities(capabilityFor('bytedance/seedance-2.0/reference-to-video'));
  assert.equal(cap.media.image.maxFiles ?? 1, flag === 'true' ? 9 : 1);
  const model = { ...MODELS.find(m => m.id === contract.modelId), media: cap.media, capabilities: cap, aspects: cap.inputs.aspect_ratio?.values };
  const context = { contract, sourceContract: contract, model, modelId: model.id, live: true, catalogLive: true, templatePhotosUnavailable };
  for (const path of paths) {
    const unavailable = new Function('context', `with(context) { return ${expression(path, 'photosUnavailable')}; }`)(context);
    assert.equal(unavailable, flag !== 'true', path);
    const source = readFileSync(path, 'utf8');
    assert.match(source, /photosUnavailable/);
    if (path.includes('/create/')) {
      assert.match(source, path.endsWith('.tsx') ? /slots\.length && !photosUnavailable/ : /photosUnavailable \? null : boundCount/);
      assert.match(expression(path, path.endsWith('.tsx') ? 'ready' : 'templateBlocked'), /photosUnavailable/);
    }
  }
  const f = fixture('en', `/presets/${preset.id}`, { moduleMocks: { '../_lib/useCatalog': { useCatalog: () => ({ models: [model], live: true }) } } });
  const html = f.render(React.createElement(f.load(paths[0]).UseTemplate, { preset }));
  assert.equal((html.match(/type="file"/g) || []).length, flag === 'true' ? 3 : 0);
  if (flag === 'false') { assert.match(html, /needs more photos than the model currently supports/); assert.match(html, /disabled=""/); }
});
test('single-photo and custom templates retain their capability behavior', () => {
  assert.equal(templatePhotosUnavailable({ ...contract, slotCount: 1 }, { image: {} }), false);
  assert.equal(templatePhotosUnavailable({ ...contract, class: 'like-for-like-safe' }, {}), false);
  assert.equal(templatePhotosUnavailable(contract, undefined), true);
});
