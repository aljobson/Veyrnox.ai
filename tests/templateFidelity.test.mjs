import { compressContractData, contractData } from '../lib/expandTemplateContract.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audit, hash, packContracts } from '../scripts/audit-template-fidelity.mjs';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { templateInputs } from '../app/veyrnox/_lib/templateGenerate.js';
import { templateSourceUnsupported } from '../app/veyrnox/_lib/templateSourceBlock.js';
import { TEMPLATE_REFERENCE_PRIORITY } from '../lib/templateReferencePriority.js';
const report = audit();
const contracts = Object.values(report.contracts);
test('fidelity classification totals and generated contract bytes are pinned', () => {
  // Baseline classifications plus the independently audited 46-video split (syntx100Templates.test.mjs).
  assert.deepEqual(report.totals, {"like-for-like-safe":220,"bound":181,"blocked-needs-video":392,"unsupported":111});
  const stored = JSON.parse(readFileSync(new URL('../lib/templateFidelityContracts.json', import.meta.url)));
  const packed = packContracts(report.contracts);
  assert.equal(JSON.stringify(compressContractData(packed)) + '\n', readFileSync(new URL('../lib/templateFidelityContracts.json', import.meta.url), 'utf8'), 'regeneration must be byte-identical; inspect class changes before accepting drift');
  // The prompts and rows are compressed on disk (Worker size budget); compare what they inflate to, not the compressed bytes.
  assert.deepEqual({ contractVersion: stored.contractVersion, prompts: contractData(stored).prompts, templates: contractData(stored).templates }, packed);
});
test('all admitted photo templates preserve source bytes behind the shared reference-priority line', () => {
  for (const c of contracts) {
    const p = { id: c.id, sourcePrompt: c.sourcePrompt, prompt: c.sourcePrompt, sourcePromptOrigin: 'community-source-exact' };
    for (const withPhoto of [false, true]) {
      const model = { id: c.modelId, kind: 'video', promptMax: 30_000, media: c.identityLine ? { image: { required: true } } : {} };
      const inputs = templateInputs(p, model, { prompt: c.sourcePrompt, withPhoto, aspectOptions: [], durationSeconds: c.duration });
      assert.equal(inputs.prompt, withPhoto && c.identityLine ? `${TEMPLATE_REFERENCE_PRIORITY}\n\n${c.sourcePrompt}` : c.sourcePrompt, c.id);
      assert.equal(c.promptHash, hash(c.prompt));
      assert.equal(c.photoPromptHash, hash(c.photoPrompt));
      if (c.identityLine) assert.ok(c.prompt.startsWith(`${TEMPLATE_REFERENCE_PRIORITY}\n\n`), c.id);
    }
  }
});

test('every audited photo-driven contract uses reference priority and text-only contracts do not', () => {
  for (const c of contracts) {
    const photoDriven = c.requiredReferences.imageMax > 0;
    if ((c.class === 'bound' || c.class === 'like-for-like-safe') && photoDriven) {
      assert.equal(c.identityLine, true, c.id);
      assert.ok(c.prompt.startsWith(`${TEMPLATE_REFERENCE_PRIORITY}\n\n`), c.id);
    }
    if (!photoDriven) assert.equal(c.identityLine, false, c.id);
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
  const c = contracts.find(c => c.class === 'like-for-like-safe' && c.requiredReferences.imageMax && !swapNeedsSourceVideo(c.sourcePrompt));
  const result = checkTemplateRequest({ template_id: c.id, model_id: c.modelId, references: [{ slot: 'image', origin: 'upload', key: 'uploads/photo.png' }], inputs: { prompt: c.photoPrompt, duration_seconds: c.duration, ...(c.aspect ? { aspect_ratio: c.aspect } : {}), ...(c.negativePrompt ? { negative_prompt: c.negativePrompt } : {}) } });
  assert.deepEqual(result.metadata, { template_id: c.id, contract_version: 1, source_hash: c.sourceHash });
});

test('unsupported templates remain admitted without audited identity', async () => {
  const { fidelityTemplateId } = await import('../lib/templateFidelityRuntime.js');
  const unbound = contracts.filter(c => c.class === 'unsupported');
  assert.equal(unbound.length, 111, 'contracts that cannot fit the shared reference priority remain unaudited');
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

test('every photo-driven template receives the same reference-priority instruction', () => {
  const preset = { id: 'custom-recipe', prompt: 'Original scene', sourcePrompt: 'Original scene', sourcePromptOrigin: 'community-source-exact' };
  const model = { id: 'kling-3.0-i2v', kind: 'video', promptMax: 2500, media: { image: { required: true } } };
  assert.equal(templateInputs(preset, model, { prompt: preset.sourcePrompt, aspectOptions: [], withPhoto: true }).prompt, `${TEMPLATE_REFERENCE_PRIORITY}\n\n${preset.sourcePrompt}`);
  const edited = templateInputs(preset, model, { prompt: 'Edited scene', aspectOptions: [], withPhoto: true }).prompt;
  assert.equal(edited, `${TEMPLATE_REFERENCE_PRIORITY}\n\nEdited scene`);
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
  const context = { draftRecovery: {}, attachConverting: false, sourcesConverting: false, inFlight: { current: false }, sending: false, generating: false, model: {}, templateData: { id: c.id }, templateBlocked: blocked, balance: 100, payable: 0, catalogStatus: 'live', unsupportedSource: false, sourceBlocked: false };
  await new Function('context', `with (context) { return (${submit}); }`)(context)();
  assert.equal(context.inFlight.current, false);
});
