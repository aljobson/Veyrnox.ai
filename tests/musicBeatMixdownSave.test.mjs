import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { make } from './musicBeatFixtures.mjs';
import { planExport, assembleExport } from '../app/veyrnox/_lib/music/beat/beatExport.mjs';
import { createWavWriter } from '../app/veyrnox/_lib/music/beat/beatWav.mjs';
let calls, uploaded, replay = false, owner = 'one', uploadStatus = 200;
globalThis.mixdownSaveFixture = {
  getSession: () => ({ user: { id: owner } }),
  gatewayFetch: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    return body.action === 'reserve' ? { committed: replay, song_id: 'song', version_id: 'version', upload_url: 'https://r2.invalid/file', headers: { 'Content-Type': 'audio/wav', 'If-None-Match': '*' } } : { song_id: 'song', version_id: 'version', committed: true };
  },
};
const hooks = registerHooks({ load(url, context, next) {
  const name = url.endsWith('/gateway.js') ? 'gatewayFetch' : url.endsWith('/authClient.js') ? 'getSession' : null;
  return name ? { format: 'module', shortCircuit: true, source: `export const { ${name} } = globalThis.mixdownSaveFixture;` } : next(url, context);
} });
const { saveMixdownToLibrary, wavSha256, mixdownSaveError } = await import('../app/veyrnox/_lib/music/beat/beatMixdownSave.js');
hooks.deregister();
const old = globalThis.XMLHttpRequest;
globalThis.XMLHttpRequest = class {
  upload = {}; status = uploadStatus;
  open(method, url) { assert.equal(method, 'PUT'); assert.equal(url, 'https://r2.invalid/file'); }
  setRequestHeader() {}
  send(bytes) { uploaded = bytes; this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 }); this.onload(); }
};
test.after(() => { globalThis.XMLHttpRequest = old; delete globalThis.mixdownSaveFixture; });
test('save uploads the exact assembled download bytes and reserves their SHA-256', async () => {
  const doc = make(), planned = planExport(doc);
  const bytes = await assembleExport(planned, chunk => Array.from({ length: 2 }, () => new Float32Array(Math.round(chunk.endSec * 48000))), createWavWriter(planned));
  calls = []; uploaded = null;
  const progress = []; const result = await saveMixdownToLibrary({ doc, wavBytes: bytes, rightsConfirmed: false, idempotencyKey: 'same-key-1', progress: message => progress.push(message) });
  assert.equal(uploaded, bytes); assert.equal(calls[0].body.sha256, await wavSha256(bytes));
  assert.equal(await wavSha256(uploaded), await wavSha256(bytes), 'upload and download retain the same single-render hash');
  assert.equal(calls[0].body.size_bytes, bytes.byteLength); assert.equal(calls[0].body.rights_confirmed, false);
  assert.equal(calls[1].body.idempotency_key, 'same-key-1'); assert.equal(result.committed, true);
  assert.ok(progress.includes('Uploading 50%…')); assert.ok(progress.includes('Adding to your library…'));
  replay = true; uploaded = null; calls = [];
  await saveMixdownToLibrary({ doc, wavBytes: bytes, idempotencyKey: 'same-key-1' });
  assert.equal(calls.length, 1); assert.equal(uploaded, null); replay = false;
  uploadStatus = 412; calls = [];
  assert.equal((await saveMixdownToLibrary({ doc, wavBytes: bytes, idempotencyKey: 'same-key-1' })).committed, true);
});
test('oversized saves refuse before hashing or network; plain error messages preserve recovery', async () => {
  calls = [];
  await assert.rejects(saveMixdownToLibrary({ doc: make(), wavBytes: { byteLength: 26214401 }, idempotencyKey: 'large-key' }), /over 25 MB/);
  assert.equal(calls.length, 0);
  assert.match(mixdownSaveError({ status: 401 }), /Sign in again/);
  assert.match(mixdownSaveError({ status: 503 }), /Your mix is safe/);
});
