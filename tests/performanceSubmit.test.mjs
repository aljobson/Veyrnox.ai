import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGenerationSources, resolveGenerationSources } from '../lib/generationSources.js';
import { parseEditInputs } from '../lib/clipEditSources.js';
import { CAPTIONS_UNITS, editUnits, validateEdit } from '../lib/clipEdit.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { estimatedSpeechSeconds } from '../app/veyrnox/_lib/performanceStudio.js';
import {
  CAPTION_UNITS,
  captionCeilingCredits,
  captionRequest,
  createChargeAttempts,
  isChargeUnknown,
  lipSyncRequest,
  submitCaption,
} from '../app/veyrnox/_lib/performanceSubmit.js';

const VISUAL = '11111111-1111-4111-8111-111111111111';
const SPEECH = '22222222-2222-4222-8222-222222222222';
const LATENTSYNC = capabilityFor('fal-ai/latentsync');
const KLING = capabilityFor('fal-ai/kling-video/ai-avatar/v2/standard');

const sourceDeps = {
  upload: async (_auth, key) => ({
    ok: true,
    field: key.endsWith('.mp4') ? 'video_url' : key.endsWith('.png') ? 'image_url' : 'audio_url',
    contentType: key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.png') ? 'image/png' : 'audio/mpeg',
    sizeBytes: 10,
  }),
  asset: async (_auth, _id, _r2, _db, { kind }) => ({
    ok: true,
    field: `${kind}_url`,
    contentType: kind === 'audio' ? 'audio/mpeg' : kind === 'video' ? 'video/mp4' : 'image/png',
    sizeBytes: 10,
  }),
};

async function serverAccepts(record, body) {
  const read = readGenerationSources(body);
  if (!read.ok) return read.error;
  const resolved = await resolveGenerationSources({
    authId: 'user', references: read.references, keys: read.keys, assets: read.assets, record, r2cfg: {}, dbcfg: {},
  }, sourceDeps);
  return resolved.ok ? 'ok' : resolved.error;
}

const gatewayFailure = (status, code) => Object.assign(new Error(code), { status, code });

test('lip-sync bodies carry the slots the server requires for every source origin', async () => {
  const cases = [
    [LATENTSYNC, 'video', { visualKey: 'uploads/a.mp4', audioJobId: SPEECH }],
    [LATENTSYNC, 'video', { visualAssetId: VISUAL, audioJobId: SPEECH }],
    [LATENTSYNC, 'video', { visualKey: 'uploads/a.mp4', audioKey: 'uploads/a.mp3' }],
    [KLING, 'image', { visualKey: 'uploads/a.png', audioJobId: SPEECH }],
    [KLING, 'image', { visualAssetId: VISUAL, audioJobId: SPEECH }],
    [KLING, 'image', { visualAssetId: VISUAL, audioKey: 'uploads/a.mp3' }],
  ];
  for (const [record, sourceKind, sources] of cases) {
    const body = lipSyncRequest({ model: { id: 'model', credits: 12 }, sourceKind, ...sources });
    assert.equal(await serverAccepts(record, body), 'ok', JSON.stringify(sources));
    assert.equal(body.consent, true);
    assert.equal(body.confirmed_credits, 12);
  }
});

test('the previous bare asset ids are what the server refused', async () => {
  assert.equal(await serverAccepts(LATENTSYNC, { source_keys: ['uploads/a.mp4'], source_assets: [SPEECH] }), 'source_slot_invalid');
  assert.equal(await serverAccepts(KLING, { source_assets: [VISUAL, SPEECH] }), 'source_count_exceeded');
});

test('caption body passes the server parser and is priced as a whole clip', () => {
  assert.equal(parseEditInputs({ clips: [{ asset_id: VISUAL, whole: true }], captions: { preset: 'simple' } }).error, 'inputs_invalid:clips');
  const body = captionRequest({ baseJobId: VISUAL, seconds: 20.034, preset: 'simple', confirmedCredits: 14 });
  assert.equal(parseEditInputs(body.inputs).ok, true);
  const edit = validateEdit({ clips: [{ ...body.inputs.clips[0], key: 'k', duration_s: 20.034 }], captions: body.inputs.captions });
  assert.equal(edit.clips[0].whole, true);
  assert.equal(editUnits(edit), 7);
  assert.equal(body.confirmed_credits, 14);
});

test('caption ceiling matches the server unit count at the model limit', () => {
  assert.equal(CAPTION_UNITS, CAPTIONS_UNITS);
  for (const seconds of [10, 35, 36, 40]) {
    const edit = validateEdit({ clips: [{ key: 'k', in_s: 0, out_s: seconds, duration_s: seconds }], captions: { preset: 'simple' } });
    assert.equal(captionCeilingCredits(2, seconds), editUnits(edit) * 2, `${seconds}s`);
  }
  assert.equal(captionCeilingCredits(2, 180), 24, 'the clip editor stops at 60 seconds');
  assert.equal(captionCeilingCredits(undefined, 40), 0);
});

test('caption submit charges the server price, and refuses more than was approved', async () => {
  const sent = [];
  const post = async (body) => {
    sent.push(body);
    if (body.confirmed_credits === 0) throw Object.assign(gatewayFailure(409, 'credit_confirmation_mismatch'), { body: { expected_credits: 16 } });
    return { job_id: 'caption-job' };
  };
  const attempts = createChargeAttempts({ post, lookup: async () => ({ job: null }), makeKey: () => 'key-00001' });
  const args = { attempts, post, makeKey: () => 'quote-0001', fetchLength: async () => 38, baseJobId: VISUAL, preset: 'simple' };

  const accepted = await submitCaption({ ...args, approvedCredits: 16 });
  assert.equal(accepted.job_id, 'caption-job');
  assert.equal(accepted.credits, 16);
  assert.deepEqual(sent.map((body) => body.confirmed_credits), [0, 16]);

  sent.length = 0;
  await assert.rejects(submitCaption({ ...args, approvedCredits: 14 }), (error) => {
    assert.match(error.userMessage, /nothing was charged/i);
    return true;
  });
  assert.deepEqual(sent.map((body) => body.confirmed_credits), [0], 'no charging request after a higher price');
});

test('caption submit charges nothing when the clip length cannot be read', async () => {
  let posts = 0;
  const post = async () => { posts += 1; return { job_id: 'x' }; };
  const attempts = createChargeAttempts({ post, lookup: async () => ({ job: null }), makeKey: () => 'key-00001' });
  await assert.rejects(submitCaption({ attempts, post, makeKey: () => 'quote-0001', fetchLength: async () => null, baseJobId: VISUAL, preset: 'simple', approvedCredits: 16 }));
  assert.equal(posts, 0);
});

test('speech estimate counts characters for scripts written without spaces', () => {
  assert.equal(estimatedSpeechSeconds(''), 0);
  assert.equal(estimatedSpeechSeconds('one two three four five'), 3);
  assert.equal(estimatedSpeechSeconds('你'.repeat(360)), 72);
  assert.equal(estimatedSpeechSeconds('あ'.repeat(350)), 50);
  assert.equal(estimatedSpeechSeconds('한'.repeat(300)), 50);
  assert.equal(estimatedSpeechSeconds('你好 hello world'), 2);
});

test('speech estimate follows the chosen speed', () => {
  assert.equal(estimatedSpeechSeconds('你'.repeat(100), undefined, 2), 10);
  assert.equal(estimatedSpeechSeconds('你'.repeat(100), undefined, 0.5), 40);
  assert.equal(estimatedSpeechSeconds('你'.repeat(100), undefined, Number.NaN), 20);
});

function ledgerServer() {
  const jobs = new Map();
  let charges = 0;
  return {
    jobs,
    get charges() { return charges; },
    charge(key) {
      if (!jobs.has(key)) { charges += 1; jobs.set(key, { id: `job-${charges}`, state: 'queued', refunded: false }); }
      return jobs.get(key);
    },
    lookup: async (key) => ({ job: jobs.get(key) || null }),
  };
}

function keyMaker() {
  let next = 0;
  return () => `vx-key-${next += 1}`;
}

test('a lost reply followed by Retry charges once and adopts the job', async () => {
  const server = ledgerServer();
  const keys = [];
  let loseReply = true;
  const post = async (body) => {
    keys.push(body.idempotency_key);
    const job = server.charge(body.idempotency_key);
    if (loseReply) { loseReply = false; throw gatewayFailure(undefined, 'network_error'); }
    return { job_id: job.id };
  };
  const attempts = createChargeAttempts({ post, lookup: server.lookup, makeKey: keyMaker() });
  const request = { model_id: 'tts', confirmed_credits: 6, inputs: { prompt: 'Hola' } };

  await assert.rejects(attempts.send(request), (error) => isChargeUnknown(error));
  const retried = await attempts.send(request);

  assert.equal(server.charges, 1);
  assert.equal(retried.job_id, 'job-1');
  assert.equal(retried.idempotent, true); assert.equal(retried.recovering, true);
  assert.equal(keys.length, 1, 'the job was found, so nothing was sent again');
});

test('a request that never arrived replays the same key and body', async () => {
  const server = ledgerServer();
  const bodies = [];
  let drop = true;
  const post = async (body) => {
    bodies.push(JSON.stringify(body));
    if (drop) { drop = false; throw gatewayFailure(undefined, 'network_error'); }
    return { job_id: server.charge(body.idempotency_key).id };
  };
  const attempts = createChargeAttempts({ post, lookup: server.lookup, makeKey: keyMaker() });
  const request = { model_id: 'tts', inputs: { prompt: 'Hola' } };

  await assert.rejects(attempts.send(request));
  const retried = await attempts.send(request);
  assert.equal(retried.recovering, true);

  assert.equal(bodies[0], bodies[1]);
  assert.equal(server.charges, 1);
});

test('a failed lookup sends nothing and keeps the key', async () => {
  const sent = [];
  let lookupFails = true;
  const post = async (body) => {
    sent.push(body.idempotency_key);
    if (sent.length === 1) throw gatewayFailure(502, 'gateway_error');
    return { job_id: 'job' };
  };
  const lookup = async () => {
    if (lookupFails) throw gatewayFailure(429, 'rate_limited');
    return { job: null };
  };
  const attempts = createChargeAttempts({ post, lookup, makeKey: keyMaker() });
  const request = { model_id: 'tts' };

  await assert.rejects(attempts.send(request));
  await assert.rejects(attempts.send(request), (error) => isChargeUnknown(error));
  assert.equal(sent.length, 1);
  lookupFails = false;
  await attempts.send(request);
  assert.deepEqual(sent, ['vx-key-1', 'vx-key-1']);
});

test('a proven refund takes a new key, a pending failure does not', async () => {
  const server = ledgerServer();
  const post = async (body) => {
    const job = server.charge(body.idempotency_key);
    if (server.charges === 1) throw gatewayFailure(502, 'provider_submit_failed');
    return { job_id: job.id };
  };
  const attempts = createChargeAttempts({ post, lookup: server.lookup, makeKey: keyMaker() });
  const request = { model_id: 'tts' };

  await assert.rejects(attempts.send(request));
  server.jobs.get('vx-key-1').state = 'failed';
  const pending = await attempts.send(request);
  assert.equal(pending.job_id, 'job-1', 'unrefunded failure is shown, not charged again');
  assert.equal(server.charges, 1);
});

test('the real gateway client: lost reply, replay and the server price all reach the attempt path', async () => {
  const source = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const session = { access_token: 'token', user: { id: 'account-a' } };
  const deps = {
    getFreshAccessToken: async () => 'token', getSession: () => session, clearSession() {}, waitForStepUp: async () => {},
    getSelectedSocialBrand: () => null, setSelectedSocialBrand() {}, assertSocialBrandSnapshot() {},
    captureOperationalError() {}, normaliseGatewayPath: (path) => path,
    apiErrorDetails: (body, status) => ({ code: body?.error || 'gateway_error', message: `failed ${status}` }),
  };
  const { gatewayFetch } = new Function(...Object.keys(deps), `${source}\nreturn { gatewayFetch };`)(...Object.values(deps));
  const server = ledgerServer();
  const requests = [];
  let loseReply = true;
  const realFetch = globalThis.fetch;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init) => {
    requests.push(`${init.method || 'GET'} ${url}`);
    if (String(url).includes('/jobs?idempotency_key=')) {
      return json(200, await server.lookup(new URL(url, 'https://x').searchParams.get('idempotency_key')));
    }
    const body = JSON.parse(init.body);
    if (body.confirmed_credits === 0) return json(409, { error: 'credit_confirmation_mismatch', expected_credits: 16 });
    const job = server.charge(body.idempotency_key);
    if (loseReply) { loseReply = false; throw new TypeError('connection lost'); }
    return json(200, { job_id: job.id });
  };
  try {
    const post = (body) => gatewayFetch('/generations', { method: 'POST', body: JSON.stringify(body) });
    const lookup = (key) => gatewayFetch(`/jobs?idempotency_key=${encodeURIComponent(key)}`);
    const makeKey = keyMaker();
    const attempts = createChargeAttempts({ post, lookup, makeKey, owner: () => session.user.id });
    const args = { attempts, post, makeKey, fetchLength: async () => 38, baseJobId: VISUAL, preset: 'simple', approvedCredits: 16 };

    await assert.rejects(submitCaption(args), (error) => isChargeUnknown(error));
    const retried = await submitCaption(args);

    assert.equal(retried.job_id, 'job-1');
  assert.equal(retried.idempotent, true); assert.equal(retried.recovering, true);
    assert.equal(retried.credits, 16);
    assert.equal(server.charges, 1);
    assert.equal(requests.filter((line) => line.includes('/jobs?idempotency_key=')).length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a refunded attempt starts again with a fresh key', async () => {
  const server = ledgerServer();
  const post = async (body) => {
    const job = server.charge(body.idempotency_key);
    if (body.idempotency_key === 'vx-key-1') throw gatewayFailure(422, 'provider_moderation');
    return { job_id: job.id };
  };
  const attempts = createChargeAttempts({ post, lookup: server.lookup, makeKey: keyMaker() });
  const request = { model_id: 'tts' };

  await assert.rejects(attempts.send(request), (error) => isChargeUnknown(error));
  server.jobs.get('vx-key-1').refunded = true;
  const retried = await attempts.send(request);
  assert.equal(retried.job_id, 'job-2');
});

test('a refusal made before the debit is not reported as a possible charge', async () => {
  for (const [status, code] of [[400, 'source_slot_invalid'], [402, 'insufficient_balance'], [409, 'credit_confirmation_mismatch'], [429, 'rate_limited']]) {
    const keys = [];
    const post = async (body) => {
      keys.push(body.idempotency_key);
      if (keys.length === 1) throw gatewayFailure(status, code);
      return { job_id: 'job' };
    };
    const attempts = createChargeAttempts({ post, lookup: async () => assert.fail('no lookup needed'), makeKey: keyMaker() });
    await assert.rejects(attempts.send({ model_id: 'tts' }), (error) => !isChargeUnknown(error));
    await attempts.send({ model_id: 'tts' });
    assert.notEqual(keys[0], keys[1], code);
  }
});

test('a finished attempt does not capture the next deliberate generation', async () => {
  const server = ledgerServer();
  const post = async (body) => ({ job_id: server.charge(body.idempotency_key).id });
  const attempts = createChargeAttempts({ post, lookup: server.lookup, makeKey: keyMaker() });
  await attempts.send({ model_id: 'tts' });
  await attempts.send({ model_id: 'tts' });
  assert.equal(server.charges, 2);
});

test('an open attempt never crosses to another account', async () => {
  const keys = [];
  let owner = 'account-a';
  const post = async (body) => {
    keys.push(body.idempotency_key);
    if (keys.length === 1) throw gatewayFailure(undefined, 'network_error');
    return { job_id: 'job' };
  };
  const attempts = createChargeAttempts({ post, lookup: async () => assert.fail('other account must not look up'), makeKey: keyMaker(), owner: () => owner });
  await assert.rejects(attempts.send({ model_id: 'tts' }));
  owner = 'account-b';
  await attempts.send({ model_id: 'tts' });
  assert.notEqual(keys[0], keys[1]);
});

test('the studio sends every paid request through the shared attempt path', () => {
  const source = readFileSync(new URL('../app/veyrnox/app/performance/PerformanceStudioClient.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /whole:\s*true/);
  assert.doesNotMatch(source, /source_assets:/);
  assert.equal(source.match(/gatewayFetch\('\/generations'/g).length, 1, 'one poster, used by the attempt path');
  assert.doesNotMatch(source, /clipEditModel\.credits \* 7/);
  assert.doesNotMatch(source, /and was not charged/);
});
