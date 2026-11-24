import assert from 'node:assert/strict';
import test from 'node:test';
import { musicInspirationHandler } from '../lib/musicInspirationRuntime.js';
import { ImageInspirationProviderError } from '../packages/adapters/openrouterImageInspiration.js';

const AUTH = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const KEY = `uploads/${AUTH}/44444444-4444-4444-8444-444444444444.wav`;
const IMAGE_KEY = `uploads/${AUTH}/55555555-5555-4555-8555-555555555555.png`;
const ENV = { MUSIC_INSPIRATION_ENABLED: 'true', MUSIC_INSPIRATION_SCHEMA_ENABLED: 'true',
  MUSIC_INSPIRATION_MODEL: 'openai/gpt-audio', MUSIC_INSPIRATION_API_KEY: 'test', UPLOAD_INTEGRITY_ENABLED: 'true',
  MUSIC_RUNTIME_FLAGS: JSON.stringify({ schema: true, inspiration: true }),
  MUSIC_INSPIRATION_RECEIPT_SECRET: 'receipt-secret-that-is-at-least-32-bytes' };
const DB = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service' };
const R2 = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
const IMAGE_ENV = { ...ENV, MUSIC_INSPIRATION_MODEL: undefined, MUSIC_INSPIRATION_IMAGE_ENABLED: 'true',
  MUSIC_INSPIRATION_IMAGE_MODEL: 'google/gemini-vision-test' };

function wav(seconds = 1, rate = 8000) {
  const data = seconds * rate;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer); const text = (at, s) => [...s].forEach((c, i) => { b[at + i] = c.charCodeAt(0); });
  text(0, 'RIFF'); v.setUint32(4, b.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); text(36, 'data'); v.setUint32(40, data, true); return b;
}
function png(width = 64, height = 64) {
  const b = new Uint8Array(32); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); const v = new DataView(b.buffer);
  v.setUint32(16, width); v.setUint32(20, height); return b;
}
const request = (kind = 'audio', key = KEY) => new Request('https://veyrnox.test/api/v1/music/inspiration', { method: 'POST',
  headers: { 'x-veyrnox-auth-id': AUTH, 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind, key, rights_confirmed: true, idempotency_key: 'aaaaaaaa' }) });

test('image-only contract validates bytes and dimensions before using its configured provider', async () => {
  const bytes = png(); let providerInput; const names = [];
  const post = musicInspirationHandler({ env: IMAGE_ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: IMAGE_KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
    analyzeImage: async input => { providerInput = input; return { safe: true, brief: 'Crystalline blue rhythm', tags: ['blue'] }; },
    call: async name => { names.push(name); if (name === 'music_inspiration_by_key') return { ok: false, code: 'NOT_FOUND' };
      if (name === 'music_inspiration_reserve') return { ok: true, id: ID, attempt_id: ATTEMPT }; return { ok: true }; },
  });
  const response = await post(request('image', IMAGE_KEY)); assert.equal(response.status, 200);
  assert.equal(providerInput.mediaType, 'image/png'); assert.equal(providerInput.model, IMAGE_ENV.MUSIC_INSPIRATION_IMAGE_MODEL);
  assert.deepEqual(providerInput.bytes, bytes);
  assert.deepEqual(names, ['music_inspiration_by_key', 'music_inspiration_reserve', 'music_inspiration_complete']);
});

test('per-kind readiness fails before ownership, replay and quota work', async () => {
  for (const [env, kind, key] of [[ENV, 'image', IMAGE_KEY], [IMAGE_ENV, 'audio', KEY]]) {
    let touched = false;
    const post = musicInspirationHandler({ env, dbcfg: DB, r2cfg: R2, find: async () => { touched = true; },
      load: async () => { touched = true; }, call: async () => { touched = true; } });
    const response = await post(request(kind, key)); assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'music_inspiration_unavailable'); assert.equal(touched, false);
  }
});

test('permanent image provider error is persisted once and returned as a stable public code', async () => {
  const bytes = png(); let failed;
  const post = musicInspirationHandler({ env: IMAGE_ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: IMAGE_KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
    analyzeImage: async () => { throw new ImageInspirationProviderError('provider_response_invalid'); },
    call: async (name, args) => { if (name === 'music_inspiration_by_key') return { ok: false, code: 'NOT_FOUND' };
      if (name === 'music_inspiration_reserve') return { ok: true, id: ID, attempt_id: ATTEMPT };
      if (name === 'music_inspiration_fail') failed = args; return { ok: true }; },
  });
  const response = await post(request('image', IMAGE_KEY)); assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'provider_response_invalid');
  assert.equal(failed.p_error_code, 'provider_response_invalid'); assert.equal(failed.p_permanent, true);
});

test('unreadable image dimensions fail before quota reservation', async () => {
  const bytes = png(0, 64); let reserved = false;
  const post = musicInspirationHandler({ env: IMAGE_ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: IMAGE_KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
    call: async name => { if (name === 'music_inspiration_by_key') return { ok: false, code: 'NOT_FOUND' }; reserved = true; },
  });
  const response = await post(request('image', IMAGE_KEY)); assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'upload_unreadable'); assert.equal(reserved, false);
});

test('runtime verifies exact bytes, reserves once and returns a reviewable receipt', async () => {
  const bytes = wav(); const calls = []; let providerBytes;
  const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2, now: () => 100_000,
    find: async () => [{ r2_key: KEY, size_bytes: bytes.length }],
    load: async () => ({ ok: true, response: new Response(bytes) }),
    analyze: async input => { providerBytes = input.bytes; return { ok: true, safe: true, brief: 'Warm pulse', tags: ['warm'] }; },
    call: async (name, args) => { calls.push([name, args]); if (name === 'music_inspiration_by_key') return { ok: false, code: 'NOT_FOUND' }; if (name === 'music_inspiration_reserve') return { ok: true, id: ID, attempt_id: ATTEMPT }; return { ok: true }; },
  });
  const response = await post(request()); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.brief, 'Warm pulse'); assert.equal(body.idempotent, false);
  assert.deepEqual(providerBytes, bytes);
  assert.deepEqual(calls.map(([name]) => name), ['music_inspiration_by_key', 'music_inspiration_reserve', 'music_inspiration_complete']);
  assert.equal(calls[2][1].p_attempt_id, ATTEMPT); assert.match(body.receipt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('completed replay never calls the provider or rereads after admission', async () => {
  const bytes = wav(); let analyses = 0, reads = 0;
  const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
    find: async () => { reads++; return [{ r2_key: KEY, size_bytes: bytes.length }]; }, load: async () => { reads++; return { ok: true, response: new Response(bytes) }; },
    analyze: async () => { analyses++; throw new Error('should not run'); },
    call: async name => name === 'music_inspiration_by_key' ? { ok: true, id: ID, status: 'completed', safe: true,
      brief: 'Stored', tags: ['stored'], receipt: 'stored.receipt', expires_at: '2026-11-24T12:00:00Z' } : assert.fail(name),
  });
  const response = await post(request()); assert.equal(response.status, 200); assert.equal((await response.json()).idempotent, true); assert.equal(analyses, 0); assert.equal(reads, 0);
});

test('oversized reservations fail before object read, database admission or provider call', async () => {
  let touched = false;
  const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: KEY, size_bytes: 20 * 1024 * 1024 }],
    load: async () => { touched = true; }, analyze: async () => { touched = true; }, call: async name => name === 'music_inspiration_by_key' ? { ok: false, code: 'NOT_FOUND' } : (touched = true),
  });
  const response = await post(request()); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'source_too_large'); assert.equal(touched, false);
});

test('runtime flag and schema gate the route as well as capability advertisement', async () => {
  const post = musicInspirationHandler({ env: { ...ENV, MUSIC_RUNTIME_FLAGS: '{}' }, dbcfg: DB, r2cfg: R2 });
  const response = await post(request()); assert.equal(response.status, 404);
});

test('expired pending lease reaches reserve and retakes with a new fenced attempt', async () => {
  const bytes = wav(); const names = [];
  const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
    analyze: async () => ({ ok: true, safe: true, brief: 'Retaken', tags: [] }),
    call: async name => { names.push(name); if (name === 'music_inspiration_by_key') return { ok: true, id: ID, status: 'pending' };
      if (name === 'music_inspiration_reserve') return { ok: true, kind: 'retry', id: ID, attempt_id: ATTEMPT }; return { ok: true }; },
  });
  const response = await post(request()); assert.equal(response.status, 200);
  assert.deepEqual(names, ['music_inspiration_by_key', 'music_inspiration_reserve', 'music_inspiration_complete']);
});

test('stale completion returns the authoritative stored receipt', async () => {
  const bytes = wav();
  const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
    analyze: async () => ({ ok: true, safe: true, brief: 'Local loser', tags: [] }),
    call: async name => name === 'music_inspiration_by_key' ? { ok: false, code: 'NOT_FOUND' }
      : name === 'music_inspiration_reserve' ? { ok: true, id: ID, attempt_id: ATTEMPT }
        : name === 'music_inspiration_complete' ? { ok: false, code: 'STALE_ATTEMPT' }
          : { ok: true, id: ID, status: 'completed', safe: true, brief: 'Authoritative', tags: ['stored'], receipt: 'old.receipt', expires_at: '2026-11-24T12:00:00Z' },
  });
  const body = await (await post(request())).json(); assert.equal(body.brief, 'Authoritative'); assert.equal(body.receipt, 'old.receipt'); assert.equal(body.idempotent, true);
});

test('unsafe output completes permanently and returns no brief', async () => {
  const bytes = wav(); let completed;
  const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
    find: async () => [{ r2_key: KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
    analyze: async () => ({ ok: true, safe: false, brief: 'Refused', tags: [] }),
    call: async (name, args) => { if (name === 'music_inspiration_by_key') return { ok: false, code: 'NOT_FOUND' };
      if (name === 'music_inspiration_reserve') return { ok: true, id: ID, attempt_id: ATTEMPT }; if (name === 'music_inspiration_complete') completed = args; return { ok: true }; },
  });
  const response = await post(request()); assert.equal(response.status, 422); assert.equal((await response.json()).error, 'source_not_allowed'); assert.equal(completed.p_safe, false);
});

test('duration and magic-byte refusals happen before database admission', async () => {
  for (const [bytes, error] of [[wav(91), 'source_too_long'], [new Uint8Array(100), 'upload_unreadable']]) {
    let reserved = false;
    const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
      find: async () => [{ r2_key: KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
      call: async name => { if (name === 'music_inspiration_by_key') return { ok: false, code: 'NOT_FOUND' }; reserved = true; },
    });
    const response = await post(request()); assert.equal(response.status, 400); assert.equal((await response.json()).error, error); assert.equal(reserved, false);
  }
});

test('quota and key conflicts return stable public errors without calling the provider', async () => {
  const bytes = wav();
  for (const [code, status, error] of [
    ['QUOTA_EXCEEDED', 429, 'quota_exceeded'],
    ['SOURCE_ALREADY_USED', 409, 'source_already_used'],
    ['IDEMPOTENCY_CONFLICT', 409, 'idempotency_conflict'],
  ]) {
    let analyzed = false;
    const post = musicInspirationHandler({ env: ENV, dbcfg: DB, r2cfg: R2,
      find: async () => [{ r2_key: KEY, size_bytes: bytes.length }], load: async () => ({ ok: true, response: new Response(bytes) }),
      analyze: async () => { analyzed = true; },
      call: async name => name === 'music_inspiration_by_key' ? { ok: false, code: 'NOT_FOUND' }
        : name === 'music_inspiration_reserve' ? { ok: false, code } : assert.fail(name),
    });
    const response = await post(request()); assert.equal(response.status, status); assert.equal((await response.json()).error, error); assert.equal(analyzed, false);
  }
});
