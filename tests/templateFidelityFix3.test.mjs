import { contractData } from '../lib/expandTemplateContract.js';
import test from 'node:test';
import { templateRequestFingerprint } from '../lib/templateRequestFingerprint.js';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import data from '../lib/templateFidelityContracts.json' with { type: 'json' };
import { auditTemplate, packContracts } from '../scripts/audit-template-fidelity.mjs';
import { fallbackCapabilitiesFor, FALLBACK_MODEL_ENDPOINTS } from '../lib/fallbackModelCapabilities.js';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';
import { templateInputs, templateRun, submitTemplate } from '../app/veyrnox/_lib/templateGenerate.js';
import { templateContract } from '../lib/templateContract.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { templateSourceUnsupported } from '../app/veyrnox/_lib/templateSourceBlock.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', PUBLIC_HOST: 'https://veyrnox.test', FAL_KEY: 'test-fal', KIE_API_KEY: 'test-kie' });
const { POST } = await import('../app/api/v1/generations/route.js');
const contract = Object.keys(contractData(data).templates).map(templateContract).find(c => c.class === 'like-for-like-safe' && c.aspect && c.duration);
const presetFor = c => ({ id: c.id, fidelity: c, prompt: c.sourcePrompt, sourcePrompt: c.sourcePrompt, sourcePromptOrigin: 'community-source-exact', negativePrompt: c.negativePrompt });
async function webBody(c, changes = {}) {
  const cap = fallbackCapabilitiesFor(c.modelId);
  const model = { id: c.modelId, kind: cap.kind, takesNegative: !!cap.inputs.negative_prompt };
  const preset = { ...presetFor(c), ...changes.preset };
  const inputs = templateInputs(preset, model, { prompt: c.sourcePrompt, aspect: c.aspect, aspectOptions: cap.inputs.aspect_ratio?.values || [], durationSeconds: c.duration, ...changes });
  let body;
  await submitTemplate({ run: templateRun(null, 'fix3', 10, () => 'fix3-request-key'), quote: { ceilings: [10] }, model, preset, inputs, makeKey: () => 'fix3-request-key', deps: { gatewayFetch: async (_, init) => { body = JSON.parse(init.body); return { job_id: 'job' }; }, onJob() {} } });
  return body;
}
const invoke = body => POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': 'fix3-auth' }, body: JSON.stringify(body) }));

for (const [name, changes] of [['aspect', { aspect: 'custom-shape' }], ['duration', { durationSeconds: 99 }]]) {
  test(`web changed ${name} omits template_id while unchanged settings retain it`, async () => {
    assert.equal((await webBody(contract)).template_id, contract.id);
    assert.equal((await webBody(contract, changes)).template_id, undefined);
  });
}
test('web changed supported negative prompt omits template_id', async () => {
  const c = Object.keys(contractData(data).templates).map(templateContract).find(c => fallbackCapabilitiesFor(c.modelId)?.inputs.negative_prompt && c.class === 'like-for-like-safe');
  assert.equal((await webBody(c, { preset: { negativePrompt: 'changed negative' } })).template_id, undefined);
});

// Synthetic templates exercise model kinds absent from today's exact-source inventory.
// Install fixtures only in this process's JSON module; no catalog or disk writes.
function fixture(id, modelId) {
  const name = MODELS.find(model => model.id === modelId)?.name;
  assert.ok(name, modelId);
  const c = auditTemplate({ id, model: name, sourcePrompt: 'A calm landscape', sourcePromptOrigin: 'community-source-exact', durationSeconds: 5 });
  const packed = packContracts({ [id]: c });
  const stored = contractData(data).prompts;
  const offset = stored.length;
  stored.push(...packed.prompts);
  const row = packed.templates[id];
  for (const key of ['sourcePromptIndex', 'promptIndex', 'photoPromptIndex']) row[key] += offset;
  contractData(data).templates[id] = row;
  return c;
}

test('raw capability lengths are mapped objects; public fallback exposes numeric arrays', () => {
  const raw = capabilityFor(FALLBACK_MODEL_ENDPOINTS['kling-3.0-i2v']);
  assert.deepEqual(Object.keys(raw.lengths.map).map(Number), [5, 10]);
  assert.deepEqual(publicCapabilities(raw).lengths, [5, 10]);
  assert.deepEqual(fallbackCapabilitiesFor('kling-3.0-i2v').lengths, [5, 10]);
});

for (const [label, modelId] of [['optional-image', 'veo-3.1-fast-kie'], ['image-kind', 'nano-banana-kie'], ['audio-kind', 'mmaudio-v2']]) {
  test(`${label} audited template goes through web builder and route without a photo`, async t => {
    const c = fixture(`fix3-${label}`, modelId);
    const cap = fallbackCapabilitiesFor(modelId);
    if (label === 'optional-image') assert.equal(cap.media.image.required, false);
    assert.equal(c.requiredReferences.imageMin, 0);
    assert.equal(c.class, 'like-for-like-safe');
    if (cap.kind !== 'video') assert.equal(c.duration, null);
    const body = await webBody(c);
    assert.equal(body.template_id, c.id);
    assert.equal(checkTemplateRequest(body).ok, true);
    if (cap.kind !== 'video') assert.equal(Object.hasOwn(body.inputs, 'duration_seconds'), false);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      const name = new URL(url).pathname.split('/').pop(); calls.push(name);
      if (name === 'check_generation_rate_limit') return Response.json({ ok: true });
      if (name === 'model_catalog') return Response.json([{ id: modelId, provider: modelId.endsWith('-kie') ? 'kie' : 'fal', provider_endpoint: FALLBACK_MODEL_ENDPOINTS[modelId], active: true, credits_5s: 10, modality: cap.kind === 'video' ? 'text-to-video' : cap.kind === 'image' ? 'text-to-image' : 'text-to-audio' }]);
      if (name === 'users') return Response.json([{ id: 'fix3-user' }]);
      if (name === 'ledger_debit') return Response.json({ ok: true, job_id: 'original-job', idempotent: true, balance_after: 100 });
      assert.fail(`unexpected call ${url}`);
    });
    const response = await invoke(body);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).job_id, 'original-job');
    assert.ok(calls.includes('ledger_debit'));
  });
}

test('custom run without template_id completes normal route admission', async t => {
  const body = await webBody(contract, { durationSeconds: 5, aspect: '9:16' });
  delete body.template_id;
  body.model_id = 'seedance-2.0-fast';
  body.inputs = { prompt: 'Custom landscape', duration_seconds: 5, aspect_ratio: '9:16' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const name = new URL(url).pathname.split('/').pop(); calls.push(name);
    if (name === 'check_generation_rate_limit') return Response.json({ ok: true });
    if (name === 'model_catalog') return Response.json([{ id: body.model_id, provider: 'fal', provider_endpoint: 'fal-ai/wan-25-preview/text-to-video', active: true, credits_5s: 10, modality: 'text-to-video' }]);
    if (name === 'users') return Response.json([{ id: 'fix3-user' }]);
    if (name === 'ledger_debit') return Response.json({ ok: true, job_id: 'custom-job', idempotent: true, balance_after: 100 });
    assert.fail(`unexpected call ${url}`);
  });
  const response = await invoke(body);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).job_id, 'custom-job');
  assert.ok(calls.includes('ledger_debit'));
});

test('lost response replay survives a revised contract; new key cannot debit', async t => {
  const body = await webBody(contract);
  const fingerprint = await templateRequestFingerprint(body);
  const old = contractData(data).templates[contract.id].duration;
  contractData(data).templates[contract.id].duration = 99;
  t.after(() => { contractData(data).templates[contract.id].duration = old; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url); calls.push(u.pathname.split('/').pop());
    if (u.pathname.endsWith('/check_generation_rate_limit')) return Response.json({ ok: true });
    if (u.pathname.endsWith('/users')) {
      assert.equal(u.searchParams.get('auth_id'), 'eq.fix3-auth');
      return Response.json([{ id: 'fix3-owner' }]);
    }
    if (u.pathname.endsWith('/jobs')) {
      assert.equal(u.searchParams.get('user_id'), 'eq.fix3-owner');
      return Response.json(u.searchParams.get('idempotency_key') === `eq.${body.idempotency_key}` ? [{ id: 'lost-response-job', model_id: body.model_id, inputs: { template_fidelity: { request_hash: fingerprint } } }] : []);
    }
    assert.fail(`unexpected debit/provider call ${url}`);
  });
  const replay = await invoke(body);
  assert.deepEqual(await replay.json(), { job_id: 'lost-response-job', idempotent: true });
  const changed = await invoke({ ...body, inputs: { ...body.inputs, prompt: 'Different body' } });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'idempotency_conflict');
  const fresh = await invoke({ ...body, idempotency_key: 'brand-new-request' });
  assert.equal(fresh.status, 400);
  assert.equal((await fresh.json()).error, 'template_mismatch');
  assert.deepEqual(calls, ['check_generation_rate_limit', 'users', 'jobs', 'check_generation_rate_limit', 'users', 'jobs', 'check_generation_rate_limit', 'users', 'jobs']);
});

test('existing contract class controls video blocking even if local text changes', () => {
  assert.equal(templateSourceUnsupported({ id: contract.id, sourcePrompt: 'Mention @video1', sourcePromptOrigin: 'community-source-exact' }), false);
  const blocked = Object.keys(contractData(data).templates).map(templateContract).find(c => c.class === 'blocked-needs-video');
  assert.equal(templateSourceUnsupported({ id: blocked.id, sourcePrompt: 'Edited prompt' }), true);
});

test('Create blocks edited video templates using its separate guard before starting a request', async () => {
  const { readFileSync } = await import('node:fs');
  const ts = await import('typescript');
  const source = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const ast = ts.default.createSourceFile('create.js', source, ts.default.ScriptTarget.Latest, true, ts.default.ScriptKind.JSX);
  let submit;
  const visit = node => {
    if (ts.default.isFunctionDeclaration(node) && node.name?.text === 'onSubmit') submit = node.getText(ast);
    ts.default.forEachChild(node, visit);
  };
  visit(ast);
  const context = { draftRecovery: {}, attachConverting: false, sourcesConverting: false, boundBusy: false, inFlight: { current: false }, sending: false, generating: false, model: {}, balance: 100, payable: 0, catalogStatus: 'live', sourceBlocked: true };
  await new Function('context', `with (context) { return (${submit}); }`)(context)();
  assert.equal(context.inFlight.current, false);
});

test('duration fixes move zero inventory templates to unsupported and preserve 34 literal-token transports', async () => {
  const { audit } = await import('../scripts/audit-template-fidelity.mjs');
  const report = audit();
  // Baseline classifications plus the independently audited 46-video split (syntx100Templates.test.mjs).
  assert.deepEqual(report.totals, {"like-for-like-safe":232 + 0,"bound":162 + 9,"blocked-needs-video":355 + 37,"unsupported":0});
  const cs = Object.values(report.contracts);
  assert.equal(cs.filter(c => c.reasons.includes('unsupported-duration')).length, 0);
  for (const c of cs.filter(c => c.class === 'exact-transport-unbound-tokens')) {
    assert.equal(c.prompt, c.sourcePrompt);
    assert.equal(c.photoPrompt, c.sourcePrompt);
    assert.equal(c.identityLine, false);
    assert.equal(c.tokenSupport.literalImageTokensBound, false);
    assert.equal(c.requiredReferences.imageMin, 1);
    assert.equal(c.requiredReferences.imageMax, 1);
  }
});

test('preset provenance is the public contract id sent by templateStartIdFor', async () => {
  const { PRESETS } = await import('../app/veyrnox/_lib/templates.js');
  const { templateStartIdFor } = await import('../lib/templateStartCheck.js');
  const blocked = Object.keys(contractData(data).templates).map(templateContract).find(c => c.class === 'blocked-needs-video');
  assert.equal(templateStartIdFor(blocked.id, PRESETS.find(p => p.id === blocked.id), blocked.modelId), blocked.id);
});

for (const mode of ['decode-failure', 'stale-selection', 'undersized', 'valid']) {
  test(`UseTemplate photo dimension check handles ${mode} and closes decoded bitmaps`, async () => {
    const { readFileSync } = await import('node:fs');
    const ts = (await import('typescript')).default;
    const { templatePhotoError } = await import('../lib/templateFidelityRuntime.js');
    const source = readFileSync(new URL('../app/veyrnox/_components/UseTemplate.js', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('UseTemplate.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let choose;
    const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'choosePhoto') choose = node.getText(ast); ts.forEachChild(node, visit); };
    visit(ast);
    const file = { name: 'photo.png' }, sequence = { current: 0 }, state = {};
    let closed = 0;
    const context = { photoSequence: sequence, contract: { ...contract, requiredReferences: { imageMin: 1, imageMax: 1 } }, auditedTemplateId: contract.id, templatePhotoError,
      templateImageFileError: () => null, prepareUpload: async () => file,
      setPhotoError: value => { state.photoError = value; }, setPhoto: value => { state.photo = value; },
      setPhotoBusy: value => { state.busy = value; }, setHandoffError: value => { state.handoffError = value; },
      createImageBitmap: async () => {
        if (mode === 'decode-failure') throw new Error('Browser cannot decode');
        if (mode === 'stale-selection') sequence.current++;
        return { width: mode === 'undersized' ? 100 : 512, height: 512, close() { closed++; } };
      },
    };
    await new Function('context', `with (context) { return (${choose}); }`)(context)(file);
    assert.equal(state.handoffError, '');
    assert.equal(closed, mode === 'decode-failure' ? 0 : 1);
    assert.equal(state.photo, ['valid', 'decode-failure'].includes(mode) ? file : null);
    assert.equal(state.photoError, mode === 'undersized' ? 'presets.fidelity.photoMinimum' : '');
  });
}
