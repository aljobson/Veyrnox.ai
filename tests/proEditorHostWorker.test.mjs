import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle, resetCacheForTests } from '../pro-editor-host/worker.mjs';
import { planUpload, putArgs } from '../scripts/upload-pro-editor.mjs';

const PARENTS = ['https://veyrnox.ai'];
const STYLE = ["'sha256-abc='"];
const files = {
  'host.html': '<html>host</html>', 'purge.html': '<html>purge</html>', 'fc/index.html': '<html>fc</html>',
  'fc/filmcraft_web_bg.wasm': 'WASM', 'pro/hostCore.mjs': 'export {}', '_headers': 'rules', 'fc/LICENSE-MIT': 'MIT',
};
const manifest = (over = {}) => JSON.stringify({ parents: PARENTS, styleHashes: STYLE, files: Object.fromEntries(Object.keys(files).map((k) => [k, 'x'])), ...over });

function bucket(extra = {}, manifestText = manifest()) {
  const store = { ...files, 'manifest.json': manifestText, 'secret.txt': 'not published', ...extra };
  return {
    gets: [],
    async get(key) {
      this.gets.push(key);
      if (!(key in store)) return null;
      return { body: store[key], httpEtag: '"e-' + key + '"', httpMetadata: { contentType: 'x/y' }, text: async () => store[key] };
    },
  };
}
const env = (site, parents = 'https://veyrnox.ai') => ({ SITE: site, ALLOWED_PARENTS: parents });
const get = (path, init) => new Request('https://pro-editor.veyrnox.ai' + path, init);

test.beforeEach(() => resetCacheForTests());

test('serves a published file with the build\'s CSP, content type and ETag', async () => {
  const res = await handle(get('/host.html'), env(bucket()));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors https:\/\/veyrnox\.ai/);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('ETag'), '"e-host.html"');
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  const wasm = await handle(get('/fc/filmcraft_web_bg.wasm'), env(bucket()));
  assert.equal(wasm.headers.get('Content-Type'), 'application/wasm');
  assert.match(wasm.headers.get('Cache-Control'), /immutable/);
  assert.match((await handle(get('/fc/index.html'), env(bucket()))).headers.get('Content-Security-Policy'), /wasm-unsafe-eval/);
});

test('the root path is the host page; HEAD has no body; a matching ETag gives 304', async () => {
  const site = bucket();
  assert.equal((await handle(get('/'), env(site))).headers.get('ETag'), '"e-host.html"');
  const head = await handle(get('/host.html', { method: 'HEAD' }), env(site));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const cached = await handle(get('/host.html', { headers: { 'If-None-Match': '"e-host.html"' } }), env(site));
  assert.equal(cached.status, 304);
});

test('only manifest files are served: not other bucket keys, the manifest, _headers, traversal or encoded tricks', async () => {
  const site = bucket();
  for (const path of ['/secret.txt', '/manifest.json', '/_headers', '/fc/../secret.txt', '/%2e%2e/secret.txt', '/fc/', '/nope', '//host.html']) {
    const res = await handle(get(path), env(site));
    assert.ok([404, 400].includes(res.status), path + ' -> ' + res.status);
  }
  assert.equal(site.gets.includes('secret.txt'), false, 'never even read from the bucket');
  assert.equal((await handle(get('/%E0%A4%A'), env(site))).status, 400);
});

test('only GET and HEAD are allowed', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await handle(get('/host.html', { method }), env(bucket()));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'GET, HEAD');
  }
});

test('it refuses to serve when nothing is published, the manifest is damaged or the parents differ', async () => {
  const empty = { async get() { return null; } };
  assert.equal((await handle(get('/host.html'), env(empty))).status, 503);
  resetCacheForTests();
  assert.equal((await handle(get('/host.html'), env(bucket({}, 'not json'))).catch(() => ({ status: 0 }))).status, 503);
  resetCacheForTests();
  assert.equal((await handle(get('/host.html'), env(bucket(), 'https://other.example'))).status, 503);
  resetCacheForTests();
  assert.equal((await handle(get('/host.html'), env(bucket({}, manifest({ parents: ['https://veyrnox.ai', 'https://evil.example'] })))).catch(() => ({ status: 0 }))).status, 503);
  resetCacheForTests();
  assert.equal((await handle(get('/host.html'), env(bucket(), ''))).status, 503, 'no configured parents means no service');
  resetCacheForTests();
  assert.equal((await handle(get('/host.html'), env(bucket({}, manifest({ styleHashes: undefined })))).catch(() => ({ status: 0 }))).status, 503);
});

test('the manifest is cached briefly, then re-read', async () => {
  const site = bucket();
  await handle(get('/host.html'), env(site), 1000);
  await handle(get('/purge.html'), env(site), 2000);
  assert.equal(site.gets.filter((k) => k === 'manifest.json').length, 1);
  await handle(get('/host.html'), env(site), 1000 + 61_000);
  assert.equal(site.gets.filter((k) => k === 'manifest.json').length, 2);
});

test('upload plan: verifies every file against the manifest, uploads the manifest last, builds exact argv', () => {
  const dist = mkdtempSync(join(tmpdir(), 'pro-up-'));
  mkdirSync(join(dist, 'fc'));
  const a = 'hello';
  writeFileSync(join(dist, 'host.html'), a);
  writeFileSync(join(dist, 'fc', 'x.wasm'), 'w');
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ files: { 'host.html': sha(a), 'fc/x.wasm': sha('w') } }));
  const plan = planUpload(dist);
  assert.deepEqual(plan.map((i) => i.key), ['host.html', 'fc/x.wasm', 'manifest.json']);
  assert.deepEqual(putArgs('b-1', plan[1]), ['wrangler', 'r2', 'object', 'put', 'b-1/fc/x.wasm', '--file', join(dist, 'fc', 'x.wasm'), '--content-type', 'application/wasm', '--remote']);
  writeFileSync(join(dist, 'host.html'), 'tampered');
  assert.throws(() => planUpload(dist), /changed since the build: host\.html/);
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ files: { '../evil': 'x' } }));
  assert.throws(() => planUpload(dist), /unsafe key/);
});
