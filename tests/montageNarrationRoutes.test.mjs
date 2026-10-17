import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', PUBLIC_HOST: 'https://app.test', AGENT_VIDEO_ENABLED: 'true', MONTAGE_RUNNER_BASE: 'https://runner.test', MONTAGE_SIGNING_SECRET: 'synthetic-signing', MONTAGE_PLAN_SECRET: 'synthetic-plan', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test', FREE_ALLOWANCE_ENABLED: 'false' });
const { POST: planPost } = await import('../app/api/v1/montage/plan/route.js');
const { POST: generationPost } = await import('../app/api/v1/generations/route.js');
const { mintPlanToken, planIdempotencyKey } = await import('../lib/montagePlan.js');
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const BRIEF = 'A quiet blue sphere on a studio table', SCRIPT = 'This is a private quality assurance test.';
function network({ supported = true, existing = false, planSupported = supported } = {}) {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (target, init = {}) => {
    const url = new URL(String(target)), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, host: url.hostname, body });
    if (url.hostname === 'runner.test') {
      if (url.pathname === '/plan') return Response.json({ summary: 'Synthetic plan', seconds: 10, narration_supported: planSupported });
      if (url.pathname === '/status') return Response.json({ busy: false, narration_supported: supported });
      if (url.pathname === '/run') return Response.json({ ok: true });
      throw new Error(`Unexpected runner path ${url.pathname}`);
    }
    if (url.pathname === '/rest/v1/model_catalog') return Response.json([{ id: 'video-agent', provider: 'veyrnox', provider_endpoint: 'video-agent:v1', modality: 'text-to-video', credits_5s: 165, active: true, gated_flag: false }]);
    if (url.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
    if (url.pathname === '/rest/v1/jobs') return Response.json(existing && url.searchParams.get('idempotency_key') ? [{ id: JOB }] : []);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      if (name === 'ledger_debit') return Response.json({ ok: true, job_id: JOB, balance_after: 835, idempotent: existing });
      if (name === 'job_step_claim') return Response.json({ ok: true, claimed: true });
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected isolated target ${url.hostname}${url.pathname}`);
  };
  return { calls, restore() { globalThis.fetch = previous; } };
}
const request = (path, body) => new Request(`https://app.test${path}`, { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const debits = net => net.calls.filter(call => call.path.endsWith('/ledger_debit'));
async function approval(narrationText = SCRIPT) {
  const minted = await mintPlanToken({ secret: process.env.MONTAGE_PLAN_SECRET, authId: AUTH, brief: BRIEF, aspect: '9:16', credits: 165, narrationText });
  return { model_id: 'video-agent', idempotency_key: planIdempotencyKey(minted.nonce), inputs: { brief: BRIEF, aspect_ratio: '9:16', plan_id: minted.token, ...(narrationText ? { narration_text: narrationText } : {}) } };
}
test('planning checks runner narration capability before minting and returns the exact canonical script', async () => {
  for (const supported of [false, true]) {
    const net = network({ supported });
    try {
      const response = await planPost(request('/api/v1/montage/plan', { brief: BRIEF, narration_text: `  ${SCRIPT}  ` }));
      const body = await response.json();
      assert.equal(response.status, supported ? 200 : 503);
      assert.equal(net.calls.find(call => call.path === '/plan').body.narration_text, SCRIPT);
      if (supported) { assert.equal(body.narration_text, SCRIPT); assert.equal(body.plan.narration_supported, true); assert.equal(body.credits, 165); }
      else { assert.equal(body.error, 'narration_unavailable'); assert.equal(body.plan_id, undefined); }
      assert.equal(debits(net).length, 0);
    } finally { net.restore(); }
  }
});
test('unsupported or invalid narration never reaches debit; supported exact text is stored and forwarded once', async () => {
  for (const supported of [false, true]) {
    const net = network({ supported });
    try {
      const response = await generationPost(request('/api/v1/generations', await approval()));
      const body = await response.json();
      assert.equal(response.status, supported ? 200 : 503);
      if (supported) {
        assert.equal(debits(net).length, 1); assert.equal(debits(net)[0].body.p_credits, 165);
        assert.equal(debits(net)[0].body.p_inputs.narration_text, SCRIPT);
        const runs = net.calls.filter(call => call.path === '/run'); assert.equal(runs.length, 1); assert.equal(runs[0].body.narration_text, SCRIPT);
      } else { assert.equal(body.error, 'narration_unavailable'); assert.equal(debits(net).length, 0); }
    } finally { net.restore(); }
  }
});
test('invalid control characters and overlong scripts are rejected before runner access or debit', async () => {
  const net = network();
  try {
    for (const narration_text of ['two\nlines', 'bad\u0000text', 'x'.repeat(301), 7, null]) {
      const response = await planPost(request('/api/v1/montage/plan', { brief: BRIEF, narration_text }));
      assert.equal(response.status, 400); assert.equal((await response.json()).error, 'inputs_invalid:narration_text');
      const body = await approval(); body.inputs.narration_text = narration_text;
      const generation = await generationPost(request('/api/v1/generations', body));
      assert.equal(generation.status, 400); assert.equal((await generation.json()).error, 'inputs_invalid:narration_text');
    }
    assert.equal(net.calls.length, 0);
  } finally { net.restore(); }
});
test('editing or omitting script invalidates its ticket before debit, while native mode and accepted replay retain old behavior', async () => {
  const net = network({ supported: false });
  try {
    for (const text of ['', 'Changed words.']) {
      const body = await approval(); body.inputs.narration_text = text;
      const response = await generationPost(request('/api/v1/generations', body));
      assert.equal(response.status, 400); assert.equal((await response.json()).error, 'plan_mismatch');
    }
    assert.equal(debits(net).length, 0);
    assert.equal((await generationPost(request('/api/v1/generations', await approval('')))).status, 200);
  } finally { net.restore(); }
  const replay = network({ supported: false, existing: true });
  try {
    assert.equal((await generationPost(request('/api/v1/generations', await approval()))).status, 200);
    assert.equal(replay.calls.some(call => call.path === '/status' || call.path === '/run'), false);
  } finally { replay.restore(); }
});
