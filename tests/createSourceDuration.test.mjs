import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { capabilityFor, publicCapabilities, lengthsFor, checkInputs } from '../lib/modelCapabilities.js';
import * as pricing from '../app/veyrnox/_lib/modelPricing.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function sourceCard() {
  const output = { exports: {} };
  const code = ts.transpileModule(read('app/veyrnox/_components/SourceDurationCard.js'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', code)((id) => id === '../_lib/modelPricing' ? pricing : require(id), output, output.exports);
  return output.exports.SourceDurationCard;
}

test('Avatar, LatentSync and Demucs describe source duration without offering a misleading 5s choice', () => {
  const SourceDurationCard = sourceCard();
  for (const [endpoint, max] of [['fal-ai/kling-video/ai-avatar/v2/standard', 10], ['fal-ai/latentsync', 40], ['fal-ai/demucs', 120]]) {
    const record = capabilityFor(endpoint);
    const model = { kind: record.kind, capabilities: publicCapabilities(record) };
    const html = renderToStaticMarkup(SourceDurationCard({ model }));
    assert.match(html, /SOURCE DURATION/);
    assert.match(html, /Follows your uploaded source/);
    assert.ok(html.includes(`Up to ${max} seconds`), endpoint);
    assert.doesNotMatch(html, /<button|5s|FIXED OUTPUT/);
    assert.deepEqual(lengthsFor(record), [5], 'the priced internal request unit is preserved');
    const sourceInputs = Object.fromEntries(Object.keys(record.media).map((slot) => [`${slot}_url`, `https://uploads.test/${slot}`]));
    assert.deepEqual(checkInputs(record, { duration_seconds: 5, ...sourceInputs }), { ok: true });
  }
});

test('fixed or selectable generated lengths keep their own duration controls', () => {
  const SourceDurationCard = sourceCard();
  for (const endpoint of ['veo:veo3_lite', 'fal-ai/ace-step', 'fal-ai/mmaudio-v2/text-to-audio']) {
    const record = capabilityFor(endpoint);
    assert.equal(SourceDurationCard({ model: { kind: record.kind, capabilities: publicCapabilities(record) } }), null);
  }
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /model\?\.kind === 'video' && !fixedDurationLabel && !sourceDurationMax/);
  assert.match(page, /<SourceDurationCard model=\{model\} \/>/);
  assert.match(page, /duration_seconds: model\.kind === 'video' \? Number\(duration\.replace\('s', ''\)\) : undefined/);
});

test('bundled upload limits remain visible before the live catalog arrives', () => {
  const SourceDurationCard = sourceCard();
  for (const [id, max] of [['kling-avatar-v2', 10], ['latentsync', 40]]) {
    const model = MODELS.find((item) => item.id === id);
    assert.ok(renderToStaticMarkup(SourceDurationCard({ model })).includes(`Up to ${max} seconds`));
  }
  const source = read('app/veyrnox/_lib/useCatalog.js');
  const fallback = source.slice(source.indexOf('function fromFallback()'), source.indexOf('function fromApi('));
  assert.match(fallback, /media: m\.media \|\| \{\}/);
});

test('LatentSync explains the conservative speech coverage requirement, not automatic looping', () => {
  const SourceDurationCard = sourceCard();
  const html = renderToStaticMarkup(SourceDurationCard({ model: { id: 'latentsync', capabilities: publicCapabilities(capabilityFor('fal-ai/latentsync')) } }));
  assert.match(html, /Speech must not be longer than the video/);
  assert.match(html, /before charging/);
  assert.doesNotMatch(html, /automatically loop|output follows the audio/i);
});
