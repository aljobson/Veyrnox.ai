import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { audit } from '../scripts/audit-template-fidelity.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', PUBLIC_HOST: 'https://veyrnox.test' });
const { POST } = await import('../app/api/v1/generations/route.js');
const cs = Object.values(audit().contracts);
const safe = cs.find(c => c.class === 'like-for-like-safe' && c.requiredReferences.imageMin === 1);
const bound = cs.find(c => c.class === 'bound' && c.slotCount === 1);
const blocked = cs.find(c => c.class === 'blocked-needs-video');
const ref = { slot: 'image', origin: 'upload', key: 'uploads/example.png' };
const bodyFor = c => ({ model_id: c.modelId, template_id: c.id, idempotency_key: 'template-fidelity-key', inputs: { prompt: c.photoPrompt, duration_seconds: c.duration, ...(c.aspect ? { aspect_ratio: c.aspect } : {}), ...(c.negativePrompt ? { negative_prompt: c.negativePrompt } : {}) }, references: [ref] });
for (const [name, body, error] of [
  ...['community-driver-portrait', 'k9-dance-groove', 'twilight-field-memory'].flatMap(id => {
    const c = cs.find(c => c.id === id);
    return [c.sourcePrompt, c.sourcePrompt + '\n', c.sourcePrompt.replace(/\s+/g, ' '), c.sourcePrompt + '\nMake it vivid.'].flatMap((prompt, i) => [true, false].map(named => [`${id} variant ${i} template_id=${named}`, { ...bodyFor(c), template_id: named ? id : undefined, preset: id, inputs: { ...bodyFor(c).inputs, prompt } }, 'template_blocked']));
  }),
  ...[
    ['missing references', { references: [] }, 'template_references_invalid'],
    ['excess references', { references: [ref, ref] }, 'template_references_invalid'],
    ['wrong kind', { references: [{ ...ref, slot: 'video' }] }, 'template_references_invalid'],
    ['wrong model', { model_id: 'kling-3.0-i2v' }, 'template_mismatch'],
    ['source not bound', { inputs: { ...bodyFor(bound).inputs, prompt: bound.sourcePrompt } }, 'template_mismatch'],
  ].map(([label, changes, error]) => [`bound ${label}`, { ...bodyFor(bound), ...changes }, error]),
  ['blocked unchanged', bodyFor(blocked), 'template_blocked'],
  ['blocked unchanged without template_id', { ...bodyFor(blocked), template_id: undefined, preset: blocked.id }, 'template_blocked'],
  ['blocked edited video token without template_id', { ...bodyFor(blocked), template_id: undefined, preset: blocked.id, inputs: { prompt: 'Edited scene with @video1' } }, 'template_blocked'],
  ['safe edited video token without template_id', { ...bodyFor(safe), template_id: undefined, preset: safe.id, inputs: { prompt: 'Edited scene with <<<video_1>>>' } }, 'template_blocked'],
  ['too few images', { ...bodyFor(safe), references: [] }, 'template_references_invalid'],
  ['too many images', { ...bodyFor(safe), references: [ref, ref] }, 'template_references_invalid'],
  ['client video', { ...bodyFor(safe), video_url: 'https://example.com/video.mp4' }, 'template_references_invalid'],
  ['wrong model', { ...bodyFor(safe), model_id: 'seedance-2.0-fast' }, 'template_mismatch'],
  ['edited prompt', { ...bodyFor(safe), inputs: { ...bodyFor(safe).inputs, prompt: 'edited' } }, 'template_mismatch'],
  ['appended identity text', { ...bodyFor(safe), inputs: { ...bodyFor(safe).inputs, prompt: `${safe.sourcePrompt}\n\nKeep this person as the main character.` } }, 'template_mismatch'],
  ['wrong aspect', { ...bodyFor(safe), inputs: { ...bodyFor(safe).inputs, aspect_ratio: 'invalid' } }, 'template_mismatch'],
  ['wrong duration', { ...bodyFor(safe), inputs: { ...bodyFor(safe).inputs, duration_seconds: 99 } }, 'template_mismatch'],
  ['unknown template', { ...bodyFor(safe), template_id: 'does-not-exist' }, 'template_mismatch'],
]) test(`template API rejects ${name} after rate gate and authenticated replay read, before debit/provider`, async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (String(url).endsWith('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
    return Response.json({ error: 'unavailable replay lookup' }, { status: 500 });
  });
  const r = await POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111' }, body: JSON.stringify(body) }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, error);
  assert.deepEqual(calls, [{ url: 'https://db.test/rest/v1/rpc/check_generation_rate_limit', method: 'POST' }, {
    url: 'https://db.test/rest/v1/users?select=id&auth_id=eq.11111111-1111-4111-8111-111111111111&limit=1',
    method: 'GET',
  }], 'rate gate precedes the owner replay read; no debit or provider call');
});
for (const [name, body] of [
  ['valid audited request', bodyFor(safe)],
  ...['unsupported', 'bound', 'like-for-like-safe'].map(kind => {
    const c = cs.find(c => c.class === kind);
    return [`${kind} unchanged without template_id`, { ...bodyFor(c), template_id: undefined, preset: c.id }];
  }),
  ...['unsupported'].map(kind => [`${kind} legacy template_id bypasses audited checks`, bodyFor(cs.find(c => c.class === kind))]),
  ['custom blocked-preset edit without video token', { ...bodyFor(blocked), template_id: undefined, preset: blocked.id, inputs: { prompt: 'Custom landscape' } }],
  ['custom edit without template id', { ...bodyFor(safe), template_id: undefined, inputs: { prompt: 'Custom scene' } }],
]) test(`${name} reaches normal admission`, async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}, { status: 500 }); });
  const r = await POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111' }, body: JSON.stringify(body) }));
  assert.equal((await r.json()).error, 'rate_check_unavailable');
  assert.equal(calls, 1, 'normal admission reached; no provider or debit in this fixture');
});

for (const key of [undefined, '', 'short', 'bad key format']) test(`invalid idempotency key never performs replay reads: ${key}`, async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); throw Error('unexpected IO'); });
  const r = await POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': 'owner' }, body: JSON.stringify({ ...bodyFor(safe), template_id: {}, idempotency_key: key }) }));
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'idempotency_key_required');
  assert.deepEqual(calls, []);
});
for (const gate of ['limited', 'unavailable', 'throws']) test(`replay gate ${gate} prevents both database reads`, async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    if (gate === 'throws') throw Error('rate unavailable');
    return Response.json(gate === 'limited' ? { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 } : {});
  });
  const r = await POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': 'owner' }, body: JSON.stringify({ ...bodyFor(safe), template_id: {} }) }));
  assert.equal(r.status, gate === 'limited' ? 429 : 503);
  if (gate === 'limited') assert.equal(r.headers.get('retry-after'), '12');
  assert.deepEqual(calls, ['https://db.test/rest/v1/rpc/check_generation_rate_limit']);
});
