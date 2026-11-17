import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateSwapClipManifestLoader } from '../lib/templateSwapClipManifest.js';
import { sha256Hex } from '../packages/adapters/r2.js';
import { manifest, id } from './fixtures/templateSwapClips.mjs';
const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, clips: manifest }));
const pin = await sha256Hex(bytes);
const ok = () => ({ ok: true, response: new Response(bytes) });

test('verified immutable entries, content-addressed key and success cache per pin', async () => {
  let calls = 0;
  const cfg = {};
  const load = createTemplateSwapClipManifestLoader({ get: async (key, config, { signal }) => {
    calls++; assert.equal(key, `template-swap-clips/manifests/${pin}.json`);
    assert.equal(config, cfg); assert.ok(signal instanceof AbortSignal); return ok();
  } });
  const result = await load(pin, cfg);
  assert.deepEqual(result, manifest); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[id]));
  assert.equal(await load(pin, cfg), result); assert.equal(calls, 1);
});
for (const [name, value] of [
  ['invalid_json', '{'], ['version', JSON.stringify({ version: 2, clips: manifest })],
  ['invalid_entry', JSON.stringify({ version: 1, clips: { ...manifest, broken: {} } })],
  ['shape', JSON.stringify({ version: 1, clips: [] })],
]) test(name + ' fails the entire manifest', async () => {
  const data = new TextEncoder().encode(value), hash = await sha256Hex(data), logs = [];
  const load = createTemplateSwapClipManifestLoader({ get: async () => ({ ok: true, response: new Response(data) }), log: (...args) => logs.push(args) });
  assert.equal(await load(hash, {}), null); assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[template-swap] manifest unavailable'); assert.match(logs[0][1], /^[a-z_]+$/);
  assert.ok(!JSON.stringify(logs).includes(hash));
});
for (const [name, get] of [
  ['hash', async () => ({ ok: true, response: new Response('changed') })],
  ['status', async () => ({ ok: true, response: new Response(bytes, { status: 206 }) })],
  ['r2', async () => ({ ok: false })], ['transport', async () => { throw Error('private-key'); }],
  ['read', async () => ({ ok: true, response: new Response(new ReadableStream({ start(c) { c.error(Error('private')); } })) })],
]) test(name + ' is unavailable and negative cached', async () => {
  let calls = 0;
  const load = createTemplateSwapClipManifestLoader({ get: (...args) => { calls++; return get(...args); }, log: () => {} });
  assert.equal(await load(pin, {}), null); assert.equal(await load(pin, {}), null); assert.equal(calls, 1);
});
test('empty/malformed pins do not fetch', async () => {
  const load = createTemplateSwapClipManifestLoader({ get: () => assert.fail('fetch'), log: () => {} });
  for (const value of ['', undefined, 'bad']) assert.equal(await load(value, {}), null);
});
test('single flight before async work; failure window starts at settlement and retry can succeed', async () => {
  let clock = 0, calls = 0, finish;
  const load = createTemplateSwapClipManifestLoader({ now: () => clock, log: () => {}, get: () => {
    calls++; return calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(ok());
  } });
  const cold = Array.from({ length: 20 }, () => load(pin, {}));
  await Promise.resolve(); assert.equal(calls, 1);
  clock = 9000; finish({ ok: false }); assert.deepEqual(await Promise.all(cold), Array(20).fill(null));
  clock = 18999; assert.equal(await load(pin, {}), null); assert.equal(calls, 1);
  clock = 19000; const retry = await Promise.all(Array.from({ length: 20 }, () => load(pin, {})));
  assert.equal(calls, 2); assert.ok(retry.every(item => item === retry[0])); assert.deepEqual(retry[0], manifest);
  clock = 1e9; assert.equal(await load(pin, {}), retry[0]); assert.equal(calls, 2);
});
for (const mode of ['headers', 'body', 'oversize']) test(mode + ' is bounded and cancels transport/body', async () => {
  let signal, cancelled = false;
  const load = createTemplateSwapClipManifestLoader({ timeoutMs: 20, log: () => {}, get: async (_key, _cfg, opts) => {
    signal = opts.signal;
    if (mode === 'headers') return new Promise(() => {}); // Even an uncooperative transport cannot hold the request.
    return { ok: true, response: new Response(new ReadableStream({
      start(c) { if (mode === 'oversize') c.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel() { cancelled = true; return new Promise(() => {}); },
    })) };
  } });
  assert.equal(await load(pin, {}), null); assert.equal(signal.aborted, true);
  if (mode !== 'headers') assert.equal(cancelled, true);
});

test('different pins have independent successes and failures', async () => {
  const otherBytes = new TextEncoder().encode(JSON.stringify({ version: 1, clips: {} }));
  const otherPin = await sha256Hex(otherBytes);
  let calls = 0;
  const load = createTemplateSwapClipManifestLoader({ get: async key => {
    calls++; return key.includes(otherPin) ? { ok: true, response: new Response(otherBytes) } : ok();
  } });
  assert.deepEqual(await load(pin, {}), manifest);
  assert.deepEqual(await load(otherPin, {}), {});
  assert.deepEqual(await load(pin, {}), manifest);
  assert.equal(calls, 2);
});
