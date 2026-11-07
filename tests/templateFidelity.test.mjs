import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audit, packContracts } from '../scripts/audit-template-fidelity.mjs';
import { templateInputs } from '../app/veyrnox/_lib/templateGenerate.js';
import { templateSourceUnsupported } from '../app/veyrnox/_lib/templateSourceBlock.js';
const report = audit();
const contracts = Object.values(report.contracts);
test('fidelity classification totals and generated contract bytes are pinned', () => {
  assert.deepEqual(report.totals, {"like-for-like-safe":232,"bound":162,"blocked-needs-video":355,"unsupported":22});
  assert.deepEqual(JSON.parse(readFileSync(new URL('../lib/templateFidelityContracts.json', import.meta.url))), packContracts(report.contracts));
});
test('all admitted exact templates preserve source bytes with and without a photo', () => {
  for (const c of contracts) {
    const p = { id: c.id, sourcePrompt: c.sourcePrompt, prompt: c.sourcePrompt, sourcePromptOrigin: 'community-source-exact' };
    for (const withPhoto of [false, true]) {
      const inputs = templateInputs(p, { id: c.modelId, kind: 'video' }, { prompt: c.sourcePrompt, withPhoto, aspectOptions: [], durationSeconds: c.duration });
      assert.equal(inputs.prompt, c.sourcePrompt, c.id);
      assert.equal(c.promptHash, c.class === 'bound' ? c.boundHash : c.sourceHash);
      assert.equal(c.photoPromptHash, c.class === 'bound' ? c.boundHash : c.sourceHash);
      assert.equal(c.identityLine, false);
    }
  }
});

test('blocked contracts stay blocked even when issue hints are absent', async () => {
  const { checkTemplateRequest } = await import('../lib/templateFidelity.js');
  for (const c of contracts.filter(c => c.class === 'blocked-needs-video')) {
    assert.equal(checkTemplateRequest({ template_id: c.id }).error, 'template_blocked', c.id);
    if (c.class === 'blocked-needs-video') assert.equal(templateSourceUnsupported({ id: c.id, sourcePrompt: c.sourcePrompt, sourcePromptOrigin: 'community-source-exact' }), true, c.id);
  }
});

test('photo quality floor and single-image guard are explicit', async () => {
  const { templatePhotoError } = await import('../lib/templateFidelityRuntime.js');
  const c = contracts.find(c => c.class === 'bound' && c.slotCount === 1);
  assert.equal(templatePhotoError(c, 256, 256), null);
  assert.equal(templatePhotoError(c, 255, 1024), 'presets.fidelity.photoMinimum');
  assert.equal(templatePhotoError(c, undefined, undefined), 'presets.fidelity.photoMinimum');
  assert.equal(templatePhotoError(c, 1024, 1024, 2), 'presets.fidelity.singlePhoto');
});
test('server stores only informative safe-contract metadata', async () => {
  const { checkTemplateRequest } = await import('../lib/templateFidelity.js');
  const c = contracts.find(c => c.class === 'like-for-like-safe' && c.requiredReferences.imageMax);
  const result = checkTemplateRequest({ template_id: c.id, model_id: c.modelId, references: [{ slot: 'image', origin: 'upload', key: 'uploads/photo.png' }], inputs: { prompt: c.photoPrompt, duration_seconds: c.duration, ...(c.aspect ? { aspect_ratio: c.aspect } : {}), ...(c.negativePrompt ? { negative_prompt: c.negativePrompt } : {}) } });
  assert.deepEqual(result.metadata, { template_id: c.id, contract_version: 1, source_hash: c.sourceHash });
});

test('unsupported templates remain admitted without audited identity', async () => {
  const { fidelityTemplateId } = await import('../lib/templateFidelityRuntime.js');
  const unbound = contracts.filter(c => c.class === 'unsupported');
  assert.equal(unbound.length, 22);
  for (const c of unbound) {
    assert.equal(fidelityTemplateId(c, c.sourcePrompt, c.modelId), undefined);
    assert.equal(fidelityTemplateId(c, c.sourcePrompt, 'different-model'), undefined);
    assert.equal(fidelityTemplateId(c, `${c.sourcePrompt} edited`, c.modelId), undefined);
  }
});

test('public projection adds a negative prompt only when one is supplied', async () => {
  const { toPublicPresets } = await import('../lib/publicPresets.js');
  const { PRESETS } = await import('../app/veyrnox/_lib/templates.js');
  const [withNegative] = toPublicPresets([], [{ ...PRESETS[0], negativePrompt: 'blur' }]);
  assert.equal(withNegative.negativePrompt, 'blur');
  const rows = toPublicPresets([]);
  assert.ok(rows.length);
  for (const row of rows) assert.ok(row.negativePrompt === undefined || row.negativePrompt.length > 0);
});

test('owner exact-only transport never changes an unedited exact source prompt; an edited prompt keeps the existing photo guidance', () => {
  const preset = { id: 'custom-recipe', prompt: 'Original scene', sourcePrompt: 'Original scene', sourcePromptOrigin: 'community-source-exact' };
  const model = { id: 'kling-3.0-i2v', kind: 'video' };
  assert.equal(templateInputs(preset, model, { prompt: preset.sourcePrompt, aspectOptions: [], withPhoto: true }).prompt, preset.sourcePrompt);
  const edited = templateInputs(preset, model, { prompt: 'Edited scene', aspectOptions: [], withPhoto: true }).prompt;
  assert.ok(edited.startsWith('Edited scene') && edited.includes('The person in the attached photo'));
});

test('Create blocks an edited video-dependent template before starting a request', async () => {
  const { fidelityBlocked } = await import('../lib/templateFidelityRuntime.js');
  const c = contracts.find(c => c.class === 'blocked-needs-video');
  const source = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const guard = source.match(/const sourceReferenceBlocked = useMemo\(\(\) => (.+), \[swapId, sourceContract, activeTemplate, keptTemplate\]\);/);
  assert.ok(guard, 'template blocking stays separate and memoized with its dependencies');
  assert.doesNotMatch(source, /model\.templateBlocked\s*=/, 'rendering must not mutate the catalog model');
  const expression = guard[1];
  const blocked = new Function('swapId', 'sourceContract', 'activeTemplate', 'keptTemplate', 'fidelityBlocked', 'templateSourceUnsupported', 'promptNeedsVideo', `return ${expression}`)(null, c, { id: c.id, sourcePrompt: c.sourcePrompt, prompt: 'Edited text' }, null, fidelityBlocked, templateSourceUnsupported, false);
  assert.equal(blocked, true);
  // Parse the production function body; the early guard must need no upload or request dependency.
  const ts = await import('typescript');
  const ast = ts.default.createSourceFile('create.js', source, ts.default.ScriptTarget.Latest, true, ts.default.ScriptKind.JSX);
  let submit;
  const visit = node => {
    if (ts.default.isFunctionDeclaration(node) && node.name?.text === 'onSubmit') submit = node.getText(ast);
    ts.default.forEachChild(node, visit);
  };
  visit(ast);
  const context = { draftRecovery: {}, attachConverting: false, sourcesConverting: false, inFlight: { current: false }, sending: false, generating: false, model: {}, templateData: { id: c.id }, templateBlocked: blocked, balance: 100, payable: 0, catalogStatus: 'live', sourceBlocked: false };
  await new Function('context', `with (context) { return (${submit}); }`)(context)();
  assert.equal(context.inFlight.current, false);
});
