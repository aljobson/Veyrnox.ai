// Template preview MP4s must answer byte ranges: Apple's video player refuses
// a server that cannot (AVFoundation -11850 / -12939), so templates never
// played in the iOS app or in Safari on iPhone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRange, serveShowcase } from '../lib/showcaseVideo.js';

const FILE = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
const assets = (calls = []) => ({
    async fetch(request) {
        calls.push(request);
        assert.equal(request.headers.get('Range'), null, 'the asset binding is asked for the whole file');
        if (new URL(request.url).pathname.endsWith('missing.mp4')) return new Response('nope', { status: 404 });
        return new Response(FILE, { status: 200, headers: { 'Content-Type': 'video/mp4', ETag: '"abc"', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
    },
});
const get = (path, headers = {}, method = 'GET') => new Request(`https://veyrnox.ai${path}`, { method, headers });

test('parseRange reads a single bytes range', () => {
    assert.deepEqual(parseRange('bytes=0-1', 100), { start: 0, end: 1 });
    assert.deepEqual(parseRange('bytes=10-', 100), { start: 10, end: 99 });
    assert.deepEqual(parseRange('bytes=-5', 100), { start: 95, end: 99 });
    assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
    assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
    assert.equal(parseRange(null, 100), 'none');
    assert.equal(parseRange('bytes=0-1,5-6', 100), 'none');
    assert.equal(parseRange('items=0-1', 100), 'none');
    assert.equal(parseRange('bytes=5-2', 100), 'none');
    assert.equal(parseRange('bytes=-', 100), 'none');
});

test('a ranged request for a preview MP4 gets 206 with exactly those bytes', async () => {
    const res = await serveShowcase(get('/showcase/a.mp4', { Range: 'bytes=0-1' }), { ASSETS: assets() });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), 'bytes 0-1/100');
    assert.equal(res.headers.get('Content-Length'), '2');
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(res.headers.get('Content-Type'), 'video/mp4');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(res.headers.get('Strict-Transport-Security'), /max-age=63072000/);
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);
});

test('without a range the whole file is sent and ranges are advertised', async () => {
    const res = await serveShowcase(get('/showcase/a.mp4'), { ASSETS: assets() });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(res.headers.get('Content-Length'), '100');
    assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test('HEAD has the headers and no body', async () => {
    const res = await serveShowcase(get('/showcase/a.mp4', { Range: 'bytes=10-19' }, 'HEAD'), { ASSETS: assets() });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Length'), '10');
    assert.equal(res.body, null);
});

test('a range past the end gets 416; a stale If-Range gets the whole file', async () => {
    const past = await serveShowcase(get('/showcase/a.mp4', { Range: 'bytes=200-' }), { ASSETS: assets() });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get('Content-Range'), 'bytes */100');
    const stale = await serveShowcase(get('/showcase/a.mp4', { Range: 'bytes=0-1', 'If-Range': '"old"' }), { ASSETS: assets() });
    assert.equal(stale.status, 200);
    const fresh = await serveShowcase(get('/showcase/a.mp4', { Range: 'bytes=0-1', 'If-Range': '"abc"' }), { ASSETS: assets() });
    assert.equal(fresh.status, 206);
});

test('a missing file, a poster image and other paths pass through untouched', async () => {
    assert.equal((await serveShowcase(get('/showcase/missing.mp4', { Range: 'bytes=0-1' }), { ASSETS: assets() })).status, 404);
    const calls = [];
    const jpg = get('/showcase/a.jpg');
    await serveShowcase(jpg, { ASSETS: assets(calls) });
    assert.equal(calls[0], jpg, 'a poster is handed to the binding as sent');
    assert.equal(await serveShowcase(get('/models'), { ASSETS: assets() }), null);
    assert.equal(await serveShowcase(get('/showcases/a.mp4'), { ASSETS: assets() }), null);
});

test('wrangler sends /showcase/* to the Worker first and worker.js serves it', () => {
    const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    assert.match(wrangler, /"run_worker_first":\s*\[\s*"\/showcase\/\*"\s*\]/);
    const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
    assert.match(worker, /serveShowcase\(request, env\)/);
});
