import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function config(value, extras = {}) {
  const source = read('e2e/authenticated-fixtures.config.mjs').replace(/import[^;]+;/, '').replace('export default', 'return');
  return new Function('process', 'defineConfig', 'devices', source)({ env: { QA_FIXTURE_BASE_URL: value, ...extras } }, value => value, { 'Desktop Chrome': {} });
}

test('synthetic feature config accepts only exact loopback HTTP origins with no real storage state', () => {
  for (const value of ['http://127.0.0.1:3100', 'http://localhost:3100/', 'http://[::1]:3100']) assert.ok(config(value).use.baseURL);
  for (const value of ['https://veyrnox.ai', 'https://staging.example', 'http://localhost.evil.test', 'http://127.0.0.2:3100', 'http://user@localhost:3100', 'http://localhost:3100/path', 'http://localhost:3100?query=1', 'http://localhost:3100#fragment', 'file:///tmp/site', 'http://%6cocalhost:3100', 'http://127.1:3100', 'http://localhost:3100\\@evil.test']) assert.throws(() => config(value), /loopback/);
  assert.throws(() => config('http://localhost:3100', { QA_STORAGE_STATE: '/not-a-real-session.json' }), /storage state/);
  assert.deepEqual(config('http://localhost:3100').projects.map(project => project.name), ['synthetic-desktop', 'synthetic-mobile']);
});

test('staging account smoke excludes synthetic fixture specs and preserves its production refusal', () => {
  assert.match(read('e2e/playwright.config.mjs'), /testIgnore:\s*'authenticated-\*\.spec\.mjs'/);
  assert.match(read('e2e/env.mjs'), /refusing to run against production/);
  assert.match(config('http://localhost:3100').testMatch, /authenticated-\*/);
});

async function installedRouting() {
  const source = read('e2e/fixtures/authenticated-product.mjs').split('export async function installProductFixtures')[1];
  const factory = new Function('base', 'publicFiles', 'PAGE_TEMPLATES', 'templateMatches', 'installed', 'SYNTHETIC_USER', 'SYNTHETIC_MODELS', 'SESSION_KEY', `return async function installProductFixtures${source}`);
  const install = factory({}, new Set(['/favicon.ico']), [{ route: '/app/create' }], (template, path) => template === path, new WeakMap(), { id: 'synthetic' }, [], 'synthetic-session');
  let handler, fulfilled;
  const context = { on() {}, addInitScript: async () => {}, route: async (_, callback) => { handler = callback; } };
  const page = { on() {}, addLocatorHandler: async () => {}, getByRole: () => ({}), context: () => context };
  const fixture = await install(page, { origin: 'http://localhost:3100' });
  const request = async (url, method = 'GET', status = 200, body = null) => {
    let disposition;
    await handler({ request: () => ({ url: () => url, method: () => method, postDataJSON: () => body, headers: () => ({}) }), abort: async () => { disposition = 'abort'; }, continue: async () => { disposition = 'continue'; }, fetch: async options => { assert.equal(options.maxRedirects, 0); assert.equal(options.maxRetries, 0); return { status: () => status }; }, fulfill: async response => { fulfilled = response; disposition = 'fulfill'; } });
    return disposition;
  };
  return { fixture, request, response: () => fulfilled };
}

test('actual fixture routing aborts and fails unknown external writes and API/auth reads', async () => {
  const { fixture, request } = await installedRouting();
  for (const [url, method] of [['https://provider.invalid/queue', 'POST'], ['https://auth.invalid/auth/v1/user', 'GET'], ['https://billing.invalid/api/status', 'GET']]) {
    assert.equal(await request(url, method), 'abort');
  }
  assert.equal(fixture.unhandled.length, 3);
  assert.equal(fixture.blocked.length, 3);
});

test('actual fixture routing permits only owned pages/static reads and protects signed-out account data', async () => {
  const { fixture, request, response } = await installedRouting();
  assert.equal(await request('http://localhost:3100/app/create'), 'fulfill');
  assert.equal(await request('http://localhost:3100/favicon.ico'), 'fulfill');
  assert.equal(await request('http://localhost:3100/private-media/redirect'), 'abort');
  assert.equal(await request('http://localhost:3100/app/create', 'POST'), 'abort');
  fixture.state.user = null;
  assert.equal(await request('http://localhost:3100/api/v1/account'), 'fulfill');
  assert.equal(response().status, 401);
  assert.equal(await request('http://localhost:3100/api/v1/balance'), 'fulfill');
  assert.equal(response().status, 401);
  assert.equal(fixture.unhandled.length, 2);
});

test('actual fixture routing never follows redirects from owned pages or static assets', async () => {
  const { fixture, request } = await installedRouting();
  assert.equal(await request('http://localhost:3100/app/create', 'GET', 307), 'abort');
  assert.equal(await request('http://localhost:3100/favicon.ico', 'GET', 302), 'abort');
  assert.equal(fixture.unhandled.length, 2);
});

test('built local public auth settings are synthetic while all other auth calls remain explicit', async () => {
  const { fixture, request, response } = await installedRouting();
  assert.equal(await request('http://127.0.0.1:54321/auth/v1/settings'), 'fulfill');
  assert.deepEqual(JSON.parse(response().body), { passkeys_enabled: false, external: {} });
  assert.equal(response().headers['access-control-allow-origin'], 'http://localhost:3100');
  assert.equal(await request('http://127.0.0.1:54321/auth/v1/settings', 'OPTIONS'), 'fulfill');
  assert.equal(await request('http://127.0.0.1:54321/auth/v1/settings', 'POST'), 'abort');
  assert.equal(await request('http://127.0.0.1:54321/auth/v1/user'), 'abort');
  assert.equal(await request('https://auth.invalid/auth/v1/settings'), 'abort');
  assert.equal(fixture.unhandled.length, 3);
});

test('the default session fixture permits only POST refresh and fails unexpected authentication mutations', async () => {
  const { fixture, request, response } = await installedRouting();
  const url = 'http://localhost:3100/api/auth/session';
  assert.equal(await request(url, 'POST', 200, { action: 'refresh' }), 'fulfill');
  for (const [method, body] of [['GET', null], ['POST', null], ['POST', { action: 'clear' }], ['POST', { action: 'establish' }], ['PUT', { action: 'refresh' }]]) {
    assert.equal(await request(url, method, 200, body), 'abort');
  }
  assert.equal(fixture.unhandled.length, 5);
  fixture.state.user = null;
  assert.equal(await request(url, 'POST', 200, { action: 'refresh' }), 'fulfill');
  assert.equal(response().status, 401);
});
