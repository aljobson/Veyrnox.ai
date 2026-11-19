import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformIndexHtml } from '../pro-editor/src/transform.mjs';
import { buildHeadersFile, hostCsp, innerCsp } from '../pro-editor/src/headers.mjs';
import { headersFor, parseHeadersFile } from '../pro-editor/src/headerRules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const upstream = readFileSync(join(HERE, '..', 'pro-editor', 'fixtures', 'upstream-index-0.20.1.html'), 'utf8');

test('both inline scripts become external files and no inline script remains', () => {
  const { html, files } = transformIndexHtml(upstream);
  assert.equal(/<script(?![^>]*\ssrc=)[^>]*>/.test(html), false, 'no inline <script>');
  assert.match(html, /<script src="\.\.\/pro\/pro-fatal\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\.\.\/pro\/pro-boot\.mjs"><\/script>/);
  assert.deepEqual(Object.keys(files).sort(), ['pro-boot.mjs', 'pro-fatal.js']);
});

test('the boot module runs the gate before it imports the wasm glue', () => {
  const { files } = transformIndexHtml(upstream);
  const boot = files['pro-boot.mjs'];
  assert.ok(boot.indexOf('evaluateGate({') > 0);
  assert.ok(boot.indexOf('evaluateGate({') < boot.indexOf('filmcraft_web.js'));
  assert.match(boot, /if \(!gate\.ok\) \{/);
  // The dynamic import of the glue sits inside the else-branch only.
  const elseAt = boot.indexOf('} else {');
  assert.ok(elseAt > 0 && boot.indexOf('filmcraft_web.js') > elseAt);
});

test('both self-reload paths now go through the host restart', () => {
  const { files } = transformIndexHtml(upstream);
  assert.equal(files['pro-boot.mjs'].includes('location.replace'), false);
  assert.match(files['pro-boot.mjs'], /__proRestart\(\{ renderer: "webgl", reason: "webgpu-init" \}\)/);
  assert.equal(files['pro-fatal.js'].includes('location.reload'), false);
  assert.match(files['pro-fatal.js'], /renderer: "default", reason: "fatal-reload"/);
});

test('the original upstream logic is preserved apart from the two replaced lines', () => {
  const { files } = transformIndexHtml(upstream);
  assert.match(files['pro-boot.mjs'], /await init\(\{ module_or_path: new URL\("filmcraft_web_bg\.wasm" \+ v, location\.href\) \}\);/);
  assert.match(files['pro-boot.mjs'], /await start\("filmcraft_canvas"\);/);
  assert.match(files['pro-fatal.js'], /window\.filmcraftFatal = /);
});

test('the glue import still points at the upstream files after the module moved to /pro/', () => {
  const { files } = transformIndexHtml(upstream);
  assert.match(files['pro-boot.mjs'], /import\("\.\.\/fc\/filmcraft_web\.js" \+ v\)/);
  assert.equal(files['pro-boot.mjs'].includes('import("./filmcraft_web.js"'), false);
  // The wasm URL is resolved against the document (location.href), which is still /fc/index.html.
  assert.match(files['pro-boot.mjs'], /new URL\("filmcraft_web_bg\.wasm" \+ v, location\.href\)/);
});

test('the transform fails loudly when upstream changes', () => {
  assert.throws(() => transformIndexHtml(upstream.replace('location.reload()', 'location.href = location.href')), /fatal Reload handler/);
  assert.throws(() => transformIndexHtml(upstream.replace('params.set("webgl", "");', 'params.set("webgl", "1");')), /WebGL reload/);
  assert.throws(() => transformIndexHtml(upstream.replace('import("./filmcraft_web.js"', 'import("./other.js"')), /glue import/);
  assert.throws(() => transformIndexHtml(upstream + '<script>1</script>'), /exactly two scripts/);
  assert.throws(() => transformIndexHtml('<html></html>'), /not found/);
});

test('the inline style is allowed by hash, not by unsafe-inline', () => {
  const { styleHashes } = transformIndexHtml(upstream);
  assert.equal(styleHashes.length, 1);
  assert.match(styleHashes[0], /^'sha256-[A-Za-z0-9+/]+=*'$/);
  const policy = innerCsp(['https://veyrnox.ai'], styleHashes);
  assert.equal(policy.includes("'unsafe-inline'"), false);
  assert.equal(policy.includes("'unsafe-eval'"), false);
});

test('host page CSP: no network, no styles, framed only by the exact parents', () => {
  const policy = hostCsp(['https://veyrnox.ai', 'https://staging.veyrnox.ai']);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /frame-src 'self'/);
  assert.match(policy, /frame-ancestors https:\/\/veyrnox\.ai https:\/\/staging\.veyrnox\.ai$/);
  assert.equal(policy.includes('*'), false);
});

test('inner CSP lists the child origin and the apex origins, and blocks outbound fetches', () => {
  const policy = innerCsp(['https://veyrnox.ai'], ["'sha256-abc='"]);
  assert.match(policy, /frame-ancestors 'self' https:\/\/veyrnox\.ai$/);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(policy, /connect-src 'self' blob: data:/, 'no remote hosts: import-from-URL and model downloads are blocked');
  assert.match(policy, /frame-src 'none'/);
  assert.equal(/connect-src[^;]*https?:/.test(policy), false);
});

test('_headers: no X-Frame-Options, wasm served with its type, host and inner documents get their own CSP', () => {
  const text = buildHeadersFile({ parents: ['https://veyrnox.ai'], styleHashes: ["'sha256-abc='"] });
  assert.equal(/x-frame-options/i.test(text), false);
  const rules = parseHeadersFile(text);
  const byPath = Object.fromEntries(rules.map((r) => [r.path, r.headers]));
  assert.ok(byPath['/host.html']['Content-Security-Policy'].includes("frame-src 'self'"));
  assert.ok(byPath['/fc/index.html']['Content-Security-Policy'].includes("'wasm-unsafe-eval'"));
  assert.ok(byPath['/purge.html']['Content-Security-Policy'].includes("frame-src 'none'"), 'the purge page frames nothing');
  assert.ok(byPath['/purge.html']['Content-Security-Policy'].includes('frame-ancestors https://veyrnox.ai'));
  assert.equal(byPath['/fc/*.wasm']['Content-Type'], 'application/wasm');
  assert.match(byPath['/fc/*.wasm']['Cache-Control'], /immutable/);
  assert.equal(byPath['/host.html']['Cache-Control'], 'no-cache');
  assert.throws(() => buildHeadersFile({ parents: [], styleHashes: [] }));
});

test('the fatal overlay no longer promises recovery that a host restart would erase', () => {
  const { html } = transformIndexHtml(upstream);
  assert.equal(html.includes('come back when you reload'), false);
  assert.match(html, /Restarting the editor clears its local recovery data/);
  assert.match(html, /<button id="fatal-reload" type="button">Restart editor<\/button>/);
  assert.throws(() => transformIndexHtml(upstream.replace('come back when you reload', 'come back later')), /recovery copy/);
});

test('headersFor merges every matching rule and never matches across unrelated paths', () => {
  const rules = parseHeadersFile(buildHeadersFile({ parents: ['https://veyrnox.ai'], styleHashes: ["'sha256-abc='"] }));
  assert.equal(headersFor(rules, '/fc/filmcraft_web_bg.wasm')['Content-Type'], 'application/wasm');
  assert.ok(headersFor(rules, '/host.html')['Content-Security-Policy'].includes("frame-src 'self'"));
  assert.equal(headersFor(rules, '/pro/hostCore.mjs')['Content-Type'], 'text/javascript');
  assert.deepEqual(headersFor(rules, '/elsewhere.txt'), {});
});
