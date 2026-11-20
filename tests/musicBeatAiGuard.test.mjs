import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { definitivelyRefused } from '../app/veyrnox/_lib/music/beat/beatAiPending.mjs';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let rows = [], fail = false, calls = [], selects = [], rpcResult;
globalThis.beatGuardFixture = {
  envConfig: () => ({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture' }),
  rpc: async (name, args) => { calls.push({ name, args }); return rpcResult ?? { ok: true, quote_id: uuid(2), request_id: uuid(3), job_ids: [], state: 'queued' }; },
  select: async (table, args) => { selects.push({ table, args }); if (fail === true || fail === table) throw new Error('vendor secret'); return table === 'users' ? [{ id: uuid(4) }] : rows; },
};
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/packages/db/supabase-client.js')) return { format: 'module', shortCircuit: true, source: 'export const { rpc, select, envConfig } = globalThis.beatGuardFixture;' };
  if (url.endsWith('/lib/falDispatchWakeup.js')) return { format: 'module', shortCircuit: true, source: 'export const publishFalDispatchWakeup = () => {};' };
  return next(url, context);
} });
const quote = (await import('../app/api/v1/music/generation-quotes/route.js')).POST;
const submit = (await import('../app/api/v1/music/generations/route.js')).POST;
hooks.deregister();
const request = body => new Request('https://fixture.invalid/api/v1/music', { method: 'POST', headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': uuid(1) }, body: JSON.stringify(body) });
const flags = (beatAi, generation = true) => { process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ schema: true, dispatch: true, generation, ui: true, beatEditor: true, beatAi }); calls = []; selects = []; rows = []; fail = false; rpcResult = null; };
const body = { quote_id: uuid(2), idempotency_key: `beat-ai.${uuid(5)}` };
test('quote guard runs before parser/RPC; other models unchanged; probe makes no row', async () => {
  flags(false);
  const off = await quote(request({ model_id: 'ace-step-loop' }));
  assert.equal(off.status, 404); assert.deepEqual(await off.json(), { error: 'beat_ai_unavailable' });
  assert.equal(off.headers.get('cache-control'), 'no-store'); assert.equal(calls.length, 0);
  assert.equal((await quote(request({ mode: 'simple', model_id: 'ace-step-1.5', prompt: 'Keys', duration_seconds: 10 }))).status, 201);
  assert.equal(calls[0].name, 'music_create_quote');
  flags(true); assert.equal((await quote(request({ model_id: 'ace-step-loop' }))).status, 400); assert.equal(calls.length, 0);
  flags(true, false); const disabled = await quote(request({ model_id: 'ace-step-loop' }));
  assert.equal(disabled.status, 404); assert.deepEqual(await disabled.json(), { error: 'music_unavailable' });
});
test('new own beat work is retryably refused; interleaved original can later replay', async () => {
  flags(false); rows = [{ model_id: 'ace-step-loop', consumed_at: null }];
  const response = await submit(request(body));
  assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'beat_ai_unavailable' }); assert.equal(calls.length, 0);
  assert.deepEqual(selects[1].args, { columns: 'model_id,consumed_at', filter: `id=eq.${uuid(2)}&user_id=eq.${uuid(4)}`, limit: 1 });
  assert.equal(definitivelyRefused({ status: 503, code: 'beat_ai_unavailable', retryAfter: 60 }), false);
  rows[0].consumed_at = new Date().toISOString();
  assert.equal((await submit(request(body))).status, 202); assert.equal(calls[0].args.p_idempotency_key, body.idempotency_key);
});
for (const [name, row] of [['other model', { model_id: 'ace-step-1.5', consumed_at: null }], ['foreign or missing quote', null]]) {
  test(`${name} reaches existing RPC`, async () => { flags(false); rows = row ? [row] : []; assert.equal((await submit(request(body))).status, 202); assert.equal(calls[0].name, 'music_submit_pair'); });
}
test('select failure fails closed; on skips all selects', async () => {
  flags(false); fail = true;
  const result = await submit(request(body)); assert.equal(result.status, 502); assert.deepEqual(await result.json(), { error: 'temporarily_unavailable' }); assert.equal(calls.length, 0);
  flags(true); assert.equal((await submit(request(body))).status, 202); assert.equal(selects.length, 0); assert.equal(calls[0].name, 'music_submit_pair');
});

test('missing/foreign quotes preserve the RPC NOT_FOUND response; quote-select errors fail closed', async () => {
  flags(false); rpcResult = { ok: false, code: 'NOT_FOUND' };
  const missing = await submit(request(body));
  assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), { error: 'not_found' });
  assert.equal(calls[0].name, 'music_submit_pair');
  flags(false); fail = 'music_generation_quotes';
  assert.equal((await submit(request(body))).status, 502); assert.equal(calls.length, 0);
});
