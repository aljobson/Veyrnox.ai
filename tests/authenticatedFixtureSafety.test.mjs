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

async function installedRouting(controls = {}) {
  const source = read('e2e/fixtures/authenticated-product.mjs').split('export async function installProductFixtures')[1];
  const factory = new Function('base', 'publicFiles', 'PAGE_TEMPLATES', 'templateMatches', 'installed', 'SYNTHETIC_USER', 'SYNTHETIC_MODELS', 'SESSION_KEY', `return async function installProductFixtures${source}`);
  const install = factory({}, new Set(['/favicon.ico']), [{ route: '/app/create' }], (template, path) => template === path, new WeakMap(), { id: 'synthetic' }, [], 'synthetic-session');
  let handler, fulfilled, fixture;
  const events = [], pages = [], listeners = new Map();
  const context = {
    on: (event, callback) => listeners.set(event, callback),
    off: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); },
    addInitScript: async () => {}, route: async (_, callback) => { handler = callback; },
    pages: () => pages.filter(page => !page.isClosed()),
    unrouteAll: async options => { assert.deepEqual(options, { behavior: 'wait' }); assert.equal(context.pages().length, 0); events.push('unroute'); await controls.unroute?.(fixture); },
  };
  const makePage = name => {
    let closed = false;
    const page = { on() {}, addLocatorHandler: async () => controls.prepare?.(name, context), getByRole: () => ({}), context: () => context,
      isClosed: () => closed, close: async options => { assert.equal(options.runBeforeUnload, false); events.push(`close:${name}`); await controls.close?.(name); closed = true; events.push(`closed:${name}`); } };
    pages.push(page); return page;
  };
  context.addPage = name => { const replacement = makePage(name); listeners.get('page')?.(replacement); return replacement; };
  const page = makePage('initial');
  fixture = await install(page, { origin: 'http://localhost:3100' });
  const request = async (url, method = 'GET', status = 200, body = null, callbacks = {}) => {
    let disposition;
    await handler({ request: () => ({ url: () => url, method: () => method, postDataJSON: () => body, headers: () => ({}) }), abort: async () => { disposition = 'abort'; }, continue: async () => { disposition = 'continue'; }, fetch: async options => { assert.equal(options.maxRedirects, 0); assert.equal(options.maxRetries, 0); await callbacks.fetch?.(); return { status: () => status }; }, fulfill: async response => { await callbacks.fulfill?.(); fulfilled = response; disposition = 'fulfill'; } });
    return disposition;
  };
  return { fixture, request, response: () => fulfilled, context, page, events };
}

function safetyTeardown(harness, use = async () => {}, audits = []) {
  const source = read('e2e/fixtures/authenticated-product.mjs');
  const match = source.match(/syntheticSafety: \[(async \(\{ page \}, use\) => \{[^]*?)\n  \}, \{ auto: true \}\]/);
  assert.ok(match, 'exercise the actual auto-fixture teardown, not a parallel cleanup implementation');
  const installed = new WeakMap([[harness.page, harness.fixture]]);
  const expect = (actual, message) => ({ toEqual(expected) { audits.push(message); assert.deepEqual(actual, expected, message); } });
  const run = new Function('installed', 'expect', `return (${match[1]}\n});`)(installed, expect);
  return run({ page: harness.page }, use);
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('actual auto-fixture closes pages then drains delayed fetch/fulfill before API-context disposal', async () => {
  const gate = deferred();
  const harness = await installedRouting();
  let disposed = false, ended = false;
  const request = harness.request('http://localhost:3100/app/create', 'GET', 200, null, {
    fetch: async () => { harness.events.push('fetch'); await gate.promise; },
    fulfill: async () => { assert.equal(disposed, false, 'the response UID must still belong to a live request context'); harness.events.push('fulfill'); },
  });
  await tick();
  const teardown = safetyTeardown(harness).then(() => { ended = true; });
  await tick();
  assert.equal(ended, false, 'teardown must wait for the delayed request');
  assert.equal(harness.context.pages().length, 0, 'guard remains installed while all pages close');
  gate.resolve(); await request; await teardown;
  disposed = true; harness.events.push('dispose');
  assert.deepEqual(harness.events, ['fetch', 'close:initial', 'closed:initial', 'fulfill', 'unroute', 'dispose']);
});

test('unknown external requests during page close stay blocked and fail the final safety audit', async () => {
  let harness;
  harness = await installedRouting({ close: async () => { assert.equal(await harness.request('https://provider.invalid/new-job', 'POST'), 'abort'); } });
  await assert.rejects(safetyTeardown(harness), /Every product\/auth API/);
  assert.equal(harness.fixture.unhandled.length, 1);
  assert.ok(harness.events.includes('unroute'));
});

test('delayed route exceptions are rethrown, recorded and cannot turn a drained test green', async () => {
  const gate = deferred();
  const harness = await installedRouting();
  const request = harness.request('http://localhost:3100/app/create', 'GET', 200, null, { fetch: async () => { await gate.promise; throw new Error('Synthetic late route failure'); } }).catch(error => error);
  await tick();
  const teardown = safetyTeardown(harness).catch(error => error);
  await tick(); gate.resolve();
  assert.match((await request).message, /Synthetic late route failure/);
  const error = await teardown;
  assert.ok(error instanceof Error, 'a callback failure after test assertions remains a failure');
  assert.deepEqual(harness.fixture.errors, ['Synthetic late route failure']);
  assert.ok(harness.events.includes('unroute'));
});

test('replacement-page preparations and pages created while draining are closed before removing guards', async () => {
  const gate = deferred(); let spawned = false;
  const harness = await installedRouting({ prepare: async (name, context) => {
    if (name !== 'replacement') return;
    await gate.promise;
    if (!spawned) { spawned = true; context.addPage('late'); }
  } });
  harness.context.addPage('replacement');
  let ended = false;
  const teardown = safetyTeardown(harness).then(() => { ended = true; });
  await tick(); assert.equal(ended, false); gate.resolve(); await teardown;
  assert.equal(harness.context.pages().length, 0);
  assert.ok(harness.events.indexOf('closed:late') < harness.events.indexOf('unroute'));
});

test('test-body failures still run owned page closure, route drain and both final audits', async () => {
  const harness = await installedRouting(); const audits = [];
  await assert.rejects(safetyTeardown(harness, async () => { throw new Error('Synthetic assertion failure'); }, audits), /Synthetic assertion failure/);
  assert.ok(harness.events.includes('unroute'));
  assert.equal(audits.length, 2);
});

test('drain rejection does not skip the final safety audits or get swallowed', async () => {
  const harness = await installedRouting({ unroute: async () => { throw new Error('Synthetic drain failed'); } });
  const audits = [];
  await assert.rejects(safetyTeardown(harness, undefined, audits), /Synthetic drain failed/);
  assert.equal(audits.length, 2);
});

test('errors arriving during the final route drain fail after teardown, not before observation', async () => {
  const harness = await installedRouting({ unroute: async fixture => { await tick(); fixture.errors.push('Synthetic late runtime error'); } });
  await assert.rejects(safetyTeardown(harness), /No browser runtime errors/);
});

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
