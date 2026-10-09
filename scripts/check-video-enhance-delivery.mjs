import assert from 'node:assert/strict';
import { inventory, verifyBytes, manifestText } from './video-enhance-assets.mjs';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:3187').origin;
const prefix = `/video-enhance/${inventory.version}/`;
const request = path => fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(60000) });
const checkHeaders = (response, path) => {
    assert.equal(response.status, 200, `${path}: expected HTTP 200`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${path}: missing nosniff`);
    assert.match(response.headers.get('cache-control') || '', /public.*max-age=31536000.*immutable/, `${path}: missing immutable cache policy`);
    assert.ok(response.headers.get('etag'), `${path}: missing ETag`);
};
for (const file of inventory.files) {
    const response = await request(prefix + file.path);
    checkHeaders(response, file.path);
    const mime = response.headers.get('content-type')?.split(';')[0].trim();
    const expected = file.path.endsWith('.wasm') ? ['application/wasm']
        : file.path.endsWith('.js') ? ['text/javascript', 'application/javascript']
            : file.path.endsWith('.txt') ? ['text/plain'] : ['application/octet-stream'];
    assert.ok(expected.includes(mime), `${file.path}: unexpected MIME ${mime}`);
    verifyBytes(Buffer.from(await response.arrayBuffer()), file);
    console.log(`PASS ${file.path}: bytes, MIME and cache headers`);
}
const manifest = await request(prefix + 'manifest.json');
checkHeaders(manifest, 'manifest.json');
assert.match(manifest.headers.get('content-type') || '', /^application\/json/);
assert.equal(await manifest.text(), manifestText());
const missing = await request(prefix + 'missing-runtime.wasm');
assert.equal(missing.status, 404, 'Missing runtime must not receive a successful response');
assert.doesNotMatch(missing.headers.get('cache-control') || '', /immutable/, 'Missing runtime must not be immutable');
const page = await request('/app/enhance');
assert.equal(page.status, 200, 'Editor document must be reachable');
assert.match(page.headers.get('cache-control') || '', /private|no-store/, 'Editor HTML must not become public immutable');
assert.doesNotMatch(page.headers.get('cache-control') || '', /immutable/);
const csp = page.headers.get('content-security-policy') || '';
assert.match(csp, /'nonce-[^']+'/);
assert.doesNotMatch(csp, /'wasm-unsafe-eval'|'unsafe-eval'/, 'Production evaluation policy must remain restricted');
assert.match(await page.text(), /Preview unavailable/, 'Production editor must remain disabled');
console.log('PASS manifest, missing asset, private editor HTML, nonce CSP and disabled editor');
