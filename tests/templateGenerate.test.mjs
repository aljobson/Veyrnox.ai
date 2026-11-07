import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// createErrors.js takes two strings from the gateway client; the copy under test needs none of the client itself.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
    if (s === './gateway') return { url: 'data:text/javascript,export const ACCOUNT_PAUSED_COPY = ""; export const ACCOUNT_ON_HOLD_COPY = "";', shortCircuit: true };
    return next(s, c);
}`));
const { ALL_TEMPLATES } = await import('../app/veyrnox/_lib/templates.js');
const { modelIdForName } = await import('../app/veyrnox/_lib/tokens.js');
const { ERROR_COPY } = await import('../app/veyrnox/_lib/createErrors.js');
const { allocationSnapshot } = await import('../app/veyrnox/_lib/imageBatch.js');
const { cachedSources, fileIdentity, keepUpload, UPLOAD_REUSE_MS, inlineBlockReason, photoOnlyModel, templateInputs, templateRun, submitTemplate, templateRunDead } = await import('../app/veyrnox/_lib/templateGenerate.js');

const preset = ALL_TEMPLATES.find(p => modelIdForName(p.model) && p.prompt && !p.needs);
const modelId = modelIdForName(preset.model);
const model = { id: modelId, name: preset.model, kind: 'video', modality: 'video', credits: 4, durations: [5, 10], media: {} };
const inputs = () => templateInputs(preset, model, { prompt: preset.prompt, aspect: '9:16', durationSeconds: 5, aspectOptions: ['9:16', '16:9'] });
const gatewayError = (code, extra = {}) => Object.assign(new Error(code), { name: 'GatewayError', code, status: 400, ...extra });

function harness(responses) {
  const requests = [];
  const jobs = [];
  let n = 0;
  const deps = {
    gatewayFetch: async (path, init) => {
      requests.push({ path, body: JSON.parse(init.body) });
      const next = responses[Math.min(n++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    onJob: (submitted, credits) => jobs.push({ id: submitted.job_id, credits }),
    freeAllowance: async () => ({}),
  };
  return { requests, jobs, deps };
}
let keySeq = 0;
const makeKey = () => `key-${++keySeq}`;
const send = (h, run, unit = 4) => submitTemplate({ run, quote: allocationSnapshot(run, unit, 0), model, preset, inputs: inputs(), makeKey, deps: h.deps });

test('inline success sends Create\'s body: template prompt, preset id, ceiling from the quote, key, no attachments', async () => {
  const h = harness([{ job_id: 'job-1' }]);
  const run = templateRun(null, 'a', 4, makeKey);
  const out = await send(h, run);
  assert.equal(out.error, null);
  assert.equal(h.requests.length, 1);
  const { path, body } = h.requests[0];
  assert.equal(path, '/generations');
  assert.equal(body.model_id, modelId);
  assert.equal(body.idempotency_key, run.keys[0]);
  assert.equal(body.max_charge_credits, 4, 'the ceiling is the catalogue unit price, never computed here');
  assert.equal(body.preset, preset.id);
  assert.deepEqual(body.references, []);
  assert.equal(body.consent, undefined, 'consent is sent only with an uploaded file, and none is attached here');
  assert.equal(body.inputs.prompt, preset.prompt);
  assert.equal(body.inputs.aspect_ratio, '9:16');
  assert.equal(body.inputs.duration_seconds, 5);
  assert.deepEqual(h.jobs, [{ id: 'job-1', credits: 4 }]);
});

test('a free-allowance job is shown as costing nothing', async () => {
  const h = harness([{ job_id: 'job-2', free_allowance: true }]);
  await send(h, templateRun(null, 'a', 4, makeKey));
  assert.equal(h.jobs[0].credits, 0);
});

test('a refused submit reports the typed code that createErrors words, and its key is dead (new key next time)', async () => {
  for (const code of ['insufficient_balance', 'model_gated', 'rate_limited', 'moderation']) {
    const h = harness([gatewayError(code)]);
    const run = templateRun(null, 'a', 4, makeKey);
    const out = await send(h, run);
    assert.equal(out.error.code, code);
    assert.ok(ERROR_COPY[code], `${code} has copy in createErrors.js`);
    assert.equal(h.jobs.length, 0, 'no job is shown for a refused submit');
    assert.equal(templateRunDead(run, out.error), true, 'nothing was accepted or uncertain: a new batch key is safe');
  }
  assert.match(ERROR_COPY.provider_submit_failed, /refunded/i);
  assert.match(ERROR_COPY.insufficient_balance, /Nothing was charged/);
});

test('a lost reply may have been charged: the retry uses the SAME key, so it is charged once', async () => {
  const h = harness([gatewayError('network_error', { status: 0 }), { job_id: 'job-3' }]);
  const run = templateRun(null, 'a', 4, makeKey);
  const first = await send(h, run);
  assert.equal(first.error.code, 'outcome_unknown');
  assert.equal(templateRunDead(run, first.error), false, 'the key is kept');
  const again = templateRun(run, 'a', 4, makeKey);
  assert.equal(again, run, 'the same request keeps its run');
  const second = await send(h, again);
  assert.equal(second.error, null);
  assert.equal(h.requests[0].body.idempotency_key, h.requests[1].body.idempotency_key);
  assert.equal(templateRun(run, 'changed', 4, makeKey).keys[0] !== run.keys[0], true, 'a changed request gets a new key');
});

test('a changed price asks for confirmation with the server\'s figure, keeping the key and capping the retry', async () => {
  const h = harness([gatewayError('price_changed', { body: { expected_credits: 6 } })]);
  const run = templateRun(null, 'a', 4, makeKey);
  const out = await send(h, run);
  assert.equal(out.error.code, 'price_changed');
  assert.equal(run.confirm, true);
  assert.equal(run.unit, 6);
  assert.equal(run.quote.total, 6);
  assert.equal(templateRunDead(run, out.error), false);
});

test('a refused provider job (already refunded) frees the key so the retry is a fresh request', async () => {
  const h = harness([gatewayError('provider_submit_failed')]);
  const run = templateRun(null, 'a', 4, makeKey);
  const out = await send(h, run);
  assert.equal(out.error.code, 'provider_submit_failed');
  assert.equal(templateRunDead(run, out.error), true);
});

test('only a template that needs no media, no voice and an open model generates here', () => {
  assert.equal(inlineBlockReason(preset, model), null);
  assert.equal(inlineBlockReason({ ...preset, needs: 'Your photo' }, model), 'media');
  assert.equal(inlineBlockReason(preset, { ...model, media: { image: { required: true } } }), 'media');
  assert.equal(inlineBlockReason(preset, { ...model, takesVoice: true }), 'options');
  assert.equal(inlineBlockReason(preset, { ...model, gated: true }), 'unavailable');
  assert.equal(inlineBlockReason(preset, { ...model, kind: 'audio' }), 'options');
  assert.equal(inlineBlockReason(preset, null), 'unavailable');
});

test('a template whose only media is one photo generates here when the page can attach it', () => {
  const photoModel = { ...model, media: { image: { required: true } } };
  const needing = { ...preset, needs: 'A clear portrait or full-body photo of the person' };
  assert.equal(photoOnlyModel(photoModel), true);
  assert.equal(inlineBlockReason(needing, photoModel, { photo: true }), null);
  assert.equal(inlineBlockReason(needing, photoModel), 'media', 'without the photo option the old rule stands');
  assert.equal(inlineBlockReason({ ...preset, needs: 'One video (3-10 s) and two pictures' }, photoModel, { photo: true }), 'media');
  assert.equal(inlineBlockReason(needing, { ...model, media: { image: { required: true }, video: { required: true } } }, { photo: true }), 'media');
  assert.equal(inlineBlockReason(needing, { ...model, media: { image: { required: true, minFiles: 2 } } }, { photo: true }), 'media');
  assert.equal(inlineBlockReason(needing, model, { photo: true }), 'media', 'a model with no photo slot cannot use a photo');
});

test('with a photo the prompt names the person as the lead, and the request carries the upload key and the rights tick', async () => {
  const withPhoto = templateInputs(preset, model, { prompt: preset.prompt, aspect: '9:16', durationSeconds: 5, aspectOptions: ['9:16'], withPhoto: true });
  assert.ok(withPhoto.prompt.startsWith(`${preset.prompt}\n\n`));
  assert.match(withPhoto.prompt, /person in the attached photo is the main character/);
  assert.equal(inputs().prompt, preset.prompt, 'no photo, no added line');
  const h = harness([{ job_id: 'job-9' }]);
  const run = templateRun(null, 'a', 4, makeKey);
  let uploads = 0;
  h.deps.sources = async () => { uploads += 1; return { references: [{ slot: 'image', origin: 'upload', key: 'u/1' }] }; };
  await submitTemplate({ run, quote: allocationSnapshot(run, 4, 0), model, preset, inputs: withPhoto, makeKey, deps: h.deps });
  assert.deepEqual(h.requests[0].body.references, [{ slot: 'image', origin: 'upload', key: 'u/1' }]);
  assert.equal(h.requests[0].body.consent, true);
  await submitTemplate({ run, quote: allocationSnapshot(run, 4, 0), model, preset, inputs: withPhoto, makeKey, deps: h.deps });
  assert.equal(uploads, 1, 'a retry of the same request reuses the uploaded file');
});

test('the uploaded photo is reused after a refused request discards its run, until the token changes or it ages out', async () => {
  const cache = {};
  let loads = 0;
  const load = async () => { loads += 1; return { references: [{ slot: 'image', origin: 'upload', key: `u/${loads}` }] }; };
  const first = await cachedSources(cache, 'photo-a', load, 1000);
  assert.equal((await cachedSources(cache, 'photo-a', load, 2000)).references[0].key, first.references[0].key);
  assert.equal(loads, 1, 'an unchanged retry does not upload again');
  await cachedSources(cache, 'photo-b', load, 3000);
  assert.equal(loads, 2, 'a different photo uploads');
  await cachedSources(cache, 'photo-b', load, 3000 + UPLOAD_REUSE_MS + 1);
  assert.equal(loads, 3, 'an old upload is not trusted');
  await assert.rejects(cachedSources({}, 'x', async () => { throw new Error('upload_failed'); }));
});

test('two different files with the same name, size and date are different photos', () => {
  const a = new Blob(['a']), b = new Blob(['a']);
  Object.assign(a, { name: 'me.jpg', lastModified: 1 }); Object.assign(b, { name: 'me.jpg', lastModified: 1 });
  assert.notEqual(fileIdentity(a), fileIdentity(b));
  assert.equal(fileIdentity(a), fileIdentity(a));
  assert.equal(fileIdentity(null), null);
});

test('a cached upload is kept only after a refusal that made no job', () => {
  for (const code of ['rate_limited', 'insufficient_balance', 'price_changed']) assert.equal(keepUpload({ code }), true);
  for (const code of ['provider_submit_failed', 'moderation', 'outcome_unknown', 'internal', 'upload_failed']) assert.equal(keepUpload({ code }), false);
  assert.equal(keepUpload(null), false, 'a success consumed the upload');
});

test('a failed upload is reported as upload_failed and nothing is sent', async () => {
  const h = harness([{ job_id: 'x' }]);
  h.deps.sources = async () => { throw gatewayError('upload_failed'); };
  const run = templateRun(null, 'a', 4, makeKey);
  const out = await send(h, run);
  assert.equal(out.error.code, 'upload_failed');
  assert.equal(h.requests.length, 0);
});

test('the page offers Generate only when inlineBlockReason is null, keeps Create as "Edit before generating", and prices from the catalogue', () => {
  const use = readFileSync(new URL('../app/veyrnox/_components/UseTemplate.js', import.meta.url), 'utf8');
  assert.match(use, /const inline = inlineBlockReason\(preset, model, \{ photo: true \}\) === null;/);
  assert.match(use, /\{inline && !\(generationBlocked \|\| promptBlocked \|\| !model\) && \(\s*<TemplateGenerate[^>]*unitCost=\{credits\}[^>]*preparing=\{photoBusy\}/);
  assert.match(use, /inline \? t\('presets\.use\.editBeforeGenerating'\)/);
  assert.match(use, /onClick=\{use\}/, 'the Create hand-off is unchanged');
  const comp = readFileSync(new URL('../app/veyrnox/_components/TemplateGenerate.js', import.meta.url), 'utf8');
  assert.match(comp, /ERROR_COPY/);
  assert.match(comp, /failedJobCopy/);
  assert.match(comp, /recovery\.retry/);
  assert.doesNotMatch(comp, /clipCredits|presetCredits|model\.credits/, 'no price is computed in the component');
});

test('the hook gates on balance and an unchanged request, and only a success starts a new key', () => {
  const hook = readFileSync(new URL('../app/veyrnox/_lib/useTemplateGenerate.js', import.meta.url), 'utf8');
  assert.match(hook, /balance == null \|\| payable > balance/);
  assert.match(hook, /if \(!continuation\.current \|\| continuation\.current\.identity === identity\) return;/);
  assert.match(hook, /\} else continuation\.current = null;/);
  assert.match(hook, /cachedSources\(uploaded\.current/, 'the upload is cached outside the discardable run');
  assert.match(hook, /const photoBlocked = preparing \|\|/, 'a photo being prepared blocks submitting but the running job stays mounted');
});
