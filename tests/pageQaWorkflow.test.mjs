import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/page-qa.yml', import.meta.url), 'utf8');
const stateSetup = readFileSync(new URL('../e2e/create-qa-state.mjs', import.meta.url), 'utf8');
const config = readFileSync(new URL('../e2e/page-coverage.config.mjs', import.meta.url), 'utf8');
const sweep = readFileSync(new URL('../e2e/page-coverage.spec.mjs', import.meta.url), 'utf8');

test('anonymous coverage and its artifact are independent of authenticated credentials', () => {
  const anonymousRun = workflow.indexOf('name: Sweep every page on anonymous desktop and mobile');
  const anonymousArtifact = workflow.indexOf('name: page-qa-anonymous');
  const authPrep = workflow.indexOf('name: Prepare authenticated staging session');
  assert.ok(anonymousRun >= 0 && anonymousArtifact > anonymousRun && authPrep > anonymousArtifact);
  const anonymousSteps = workflow.slice(anonymousRun, authPrep);
  assert.doesNotMatch(anonymousSteps, /E2E_EMAIL|E2E_PASSWORD|QA_STORAGE_STATE/);
  assert.match(anonymousSteps, /if: always\(\)/);
  assert.match(anonymousSteps, /page-coverage-report\/anonymous/);
  assert.match(anonymousSteps, /test-results\/page-qa-anonymous/);
});

test('page sweep bounds browser actions and stabilizes animation-dependent accessibility snapshots', () => {
  assert.match(config, /actionTimeout: 10_000/);
  assert.match(config, /reducedMotion: 'reduce'/);
  assert.match(sweep, /getByRole\('region', \{ name: 'Privacy choices' \}\)/);
  assert.match(sweep, /getByRole\('button', \{ name: 'Decline', exact: true \}\)\.click\(\)/);
});

function privacyHandlerSource() {
  const match = sweep.match(/async function handlePrivacyChoices\(page\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'privacy overlay handling must be installed before navigation, not probed only once');
  return match[0];
}

test('late privacy hydration is handled through the genuine Decline UI, not bypassed or consented', async () => {
  const source = privacyHandlerSource();
  assert.doesNotMatch(source, /localStorage|storageState|evaluate|force:|waitForTimeout|timeout:|noWaitAfter|Allow analytics|Analytics only/);
  let visible = false;
  let handler;
  const clicks = [];
  const privacy = { getByRole: (role, options) => {
    assert.equal(role, 'button');
    assert.deepEqual({ ...options }, { name: 'Decline', exact: true });
    return { click: async (...arguments_) => { assert.equal(visible, true); assert.deepEqual(arguments_, []); clicks.push('Decline'); visible = false; } };
  } };
  const page = { getByRole: (role, options) => {
    assert.equal(role, 'region');
    assert.deepEqual({ ...options }, { name: 'Privacy choices' });
    return privacy;
  }, addLocatorHandler: async (locator, callback, ...options) => {
    assert.equal(locator, privacy); assert.deepEqual(options, []); handler = callback;
  } };
  const install = runInNewContext(`(${source})`, { expect: locator => ({ toBeHidden: async () => { assert.equal(locator, privacy); assert.equal(visible, false); } }) });
  await install(page);
  assert.equal(typeof handler, 'function');
  assert.deepEqual(clicks, [], 'an absent banner must not cause a click or storage write');
  visible = true; // Hydration occurs after setup: the handler remains registered.
  await handler(privacy);
  assert.deepEqual(clicks, ['Decline']);
  assert.equal(visible, false, 'the normal gallery action can now proceed without forcing it');
});

test('a broken Decline control stays a failure rather than being retried or hidden by the harness', async () => {
  let handler;
  let clicks = 0;
  const privacy = { getByRole: () => ({ click: async () => { clicks++; throw new Error('Decline control failed'); } }) };
  const install = runInNewContext(`(${privacyHandlerSource()})`, { expect: () => assert.fail('failed Decline cannot assert successful dismissal') });
  await install({ getByRole: () => privacy, addLocatorHandler: async (_, callback) => { handler = callback; } });
  await assert.rejects(handler(privacy), /Decline control failed/);
  assert.equal(clicks, 1);
});

test('replacement pages receive their own privacy locator and callback, never a stale page closure', async () => {
  const callbacks = [];
  const selected = [];
  const install = runInNewContext(`(${privacyHandlerSource()})`, { expect: locator => ({ toBeHidden: async () => selected.push(`hidden:${locator.id}`) }) });
  for (const id of ['original', 'replacement']) {
    const locator = { id, getByRole: () => ({ click: async () => selected.push(`decline:${id}`) }) };
    await install({ getByRole: () => locator, addLocatorHandler: async (_, callback) => callbacks.push(callback) });
  }
  await callbacks[1]();
  await callbacks[0]();
  assert.deepEqual(selected, ['decline:replacement', 'hidden:replacement', 'decline:original', 'hidden:original']);
});

test('privacy handler is installed before navigation and on replacement pages without weakening gallery checks', () => {
  assert.match(sweep, /await handlePrivacyChoices\(page\);/);
  assert.ok(sweep.indexOf('await handlePrivacyChoices(page);') < sweep.indexOf('await page.goto'));
  assert.match(sweep, /page = await context.newPage\(\);\s+await handlePrivacyChoices\(page\);/);
  assert.doesNotMatch(sweep, /if \(await privacyChoices\.isVisible\(\)\)/);
  assert.match(sweep, /getByRole\('button', \{ name: 'Show more templates' \}\)\.click\(\)/);
  assert.match(sweep, /toHaveCount\(before \+ 12\)/);
  assert.match(config, /actionTimeout: 10_000/);
  assert.match(config, /navigationTimeout: 30_000/);
  assert.match(config, /retries: 0/);
});

test('page sweep waits for the mobile root streamed redirect before inspecting its document', () => {
  assert.match(sweep, /if \(entry\.pathname === '\/m'\) await page\.waitForURL\(new URL\('\/m\/create', baseURL\)\.href, \{ waitUntil: 'load' \}\)/);
  const navigation = sweep.indexOf("if (entry.pathname === '/m')");
  assert.ok(navigation >= 0 && navigation < sweep.indexOf('const metrics = await page.evaluate'));
});

test('missing authentication fails explicitly without running or overwriting anonymous coverage', () => {
  assert.match(stateSetup, /if \(!HAS_ACCOUNT\) throw new Error\('Page QA requires confirmed staging E2E_EMAIL and E2E_PASSWORD'\)/);
  assert.match(workflow, /id: auth_session/);
  assert.match(workflow, /if: always\(\) && steps\.auth_session\.outcome == 'success'/);
  assert.match(workflow, /--project desktop-authenticated --project mobile-authenticated --output test-results\/page-qa-authenticated/);
  assert.match(workflow, /QA_REPORT_DIR: page-coverage-report\/authenticated/);
  assert.match(workflow, /name: page-qa-authenticated/);
  assert.doesNotMatch(workflow, /path:.*\.scratch\/qa-session/);
});

function qaConfig(env) {
  return runInNewContext(config.replace(/import .*?from '@playwright\/test';/, '').replace('export default ', 'const result = ') + '\nresult', {
    URL, process: { env }, devices: { 'Desktop Chrome': {}, 'iPhone 13': {} },
    defineConfig: value => value,
  });
}
test('authenticated page projects include desktop and mobile without weakening anonymous projects', () => {
  const names = qaConfig({ QA_STORAGE_STATE: '/private/synthetic-state.json' }).projects.map(project => project.name);
  assert.deepEqual([...names], ['desktop-anonymous', 'mobile-anonymous', 'desktop-authenticated', 'mobile-authenticated']);
});
for (const origin of ['https://veyrnox.ai', 'https://ADMIN.VEYRNox.ai.', 'https://%76eyrnox.ai', 'https://veyrnox。ai']) {
  test(`production cannot consume authenticated storage even with anonymous opt-in ${origin}`, () => {
    assert.throws(() => qaConfig({ QA_BASE_URL: origin, QA_ALLOW_PRODUCTION: '1', QA_STORAGE_STATE: '/private/state.json' }), /authenticated.*production/);
  });
}
function authFunction(name) {
  const match = sweep.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `${name} must be testable against the actual harness source`);
  return match[0];
}

test('page QA retains uncaught error details and redacts sensitive fixture paths', () => {
  const details = runInNewContext(`(${authFunction('browserErrorDetails')})`, { URL });
  const errors = ['Editor hydration failed\n    at https://veyrnox.ai/_next/static/editor.js:1:20'];
  assert.deepEqual([...details(errors, { sensitive: false })], errors);
  const privatePath = '/app/projects/private-project-id?revision=4';
  const redacted = details([`Could not render ${privatePath}\n at ${privatePath}`], {
    sensitive: true, pathname: privatePath, template: '/app/projects/[id]',
  });
  assert.deepEqual([...redacted], ['Could not render /app/projects/[id]\n at /app/projects/[id]']);
  assert.deepEqual([...details([
    'Review failed at /social/review/synthetic-token?qa=1\n at https://staging.invalid/social/review/synthetic-token:1:20',
  ], { sensitive: true, pathname: '/social/review/synthetic-token?qa=1', template: '/social/review/[token]' })], [
    'Review failed at /social/review/[token]\n at https://staging.invalid/social/review/[token]:1:20',
  ]);
  assert.deepEqual([...details([], { sensitive: false })], []);
  assert.match(sweep, /errors\.push\(error\.stack \|\| error\.message\)/);
  assert.match(sweep, /finally \{\s+result\.browserErrors = browserErrorDetails\(errors, entry\);\s+page\.off\('pageerror', onError\)/);
});

function authPage({ status = 200, controls = true, menu = true, signIn = false } = {}) {
  const visited = [];
  const response = { url: () => 'https://staging.example.invalid/api/v1/account', request: () => ({ method: () => 'GET' }), status: () => status };
  return { visited, waitForResponse: async predicate => { assert.equal(predicate(response), true); return response; },
    goto: async pathname => visited.push(pathname),
    getByRole: (role, options) => ({ role, options, visible: role === 'heading' ? controls : typeof options.name !== 'string' ? menu : signIn }),
  };
}
test('authenticated checks require protected GET200, private controls, account menu and no sign-in shell', async () => {
  const check = runInNewContext(`(${authFunction('assertAuthenticatedPage')})`, { URL, expect: locator => ({
    toBeVisible: async () => assert.equal(locator.visible, true),
    toHaveCount: async count => assert.equal(locator.visible ? 1 : 0, count),
  }) });
  const valid = authPage();
  await check(valid, 'https://staging.example.invalid');
  assert.deepEqual(valid.visited, ['/app/account']);
  for (const options of [{ status: 401 }, { status: 403 }, { status: 502 }, { controls: false }, { menu: false }, { signIn: true }]) await assert.rejects(check(authPage(options), 'https://staging.example.invalid'));
  await assert.rejects(check({ ...authPage(), waitForResponse: async () => { throw new Error('account response never arrived'); } }, 'https://staging.example.invalid'), /never arrived/);
});
test('session loss monitoring belongs to context and catches replacement-page account or session401', () => {
  let listener;
  let removed = false;
  const context = { on: (event, callback) => { assert.equal(event, 'response'); listener = callback; }, off: (event, callback) => { assert.equal(callback, listener); removed = true; } };
  const monitor = runInNewContext(`(${authFunction('watchAuthentication')})`, { URL })(context, 'https://staging.example.invalid');
  for (const [origin, pathname, status] of [['https://other.invalid', '/api/v1/account', 401], ['https://staging.example.invalid', '/api/v1/jobs', 401], ['https://staging.example.invalid', '/api/auth/session', 200]]) {
    listener({ url: () => `${origin}${pathname}`, status: () => status });
    assert.doesNotThrow(() => monitor.assert());
  }
  listener({ url: () => 'https://staging.example.invalid/api/v1/account', status: () => 401 });
  assert.throws(() => monitor.assert(), /Authenticated session was lost/);
  monitor.stop();
  assert.equal(removed, true);
});
test('private state is checked before and after sweep and monitoring cleanup/evidence are unconditional', () => {
  assert.match(sweep, /testInfo\.project\.name\.endsWith\('-authenticated'\)/);
  assert.equal((sweep.match(/await assertAuthenticatedPage\(page, baseURL\)/g) || []).length, 2);
  assert.match(sweep, /finally \{[\s\S]*authenticationMonitor\?\.stop\(\)/);
});

test('manual production QA is opt-in and cannot cancel the staging nightly run', () => {
  assert.match(workflow, /target:\s*\n\s+description:.*\n\s+type: choice\n\s+default: staging\n\s+options:\n\s+- staging\n\s+- production/);
  assert.match(workflow, /expected_production_sha:/);
  assert.match(workflow, /group: page-qa-\$\{\{ inputs.target \|\| 'staging' \}\}/);
  assert.match(workflow, /all-pages:\n\s+if:.*github.event_name != 'workflow_dispatch'.*inputs.target != 'production'/);
  assert.match(workflow, /production-anonymous:\n\s+if:.*github.event_name == 'workflow_dispatch'.*inputs.target == 'production'/);
});

test('production has no staging session or secret steps and keeps both anonymous projects and release guards', () => {
  const production = workflow.slice(workflow.indexOf('  production-anonymous:'));
  assert.ok(production.startsWith('  production-anonymous:'));
  assert.doesNotMatch(production, /secrets\.|E2E_EMAIL|E2E_PASSWORD|QA_STORAGE_STATE|create-qa-state|desktop-authenticated/);
  assert.match(production, /QA_BASE_URL: https:\/\/veyrnox.ai/);
  assert.match(production, /QA_ALLOW_PRODUCTION: '1'/);
  assert.match(production, /QA_EXPECTED_SHA: \$\{\{ inputs.expected_production_sha \}\}/);
  assert.match(production, /--project desktop-anonymous --project mobile-anonymous/);
  const before = production.indexOf('node e2e/verify-live-release.mjs before');
  const sweep = production.indexOf('npx playwright test');
  const after = production.indexOf('node e2e/verify-live-release.mjs after');
  assert.ok(before >= 0 && before < sweep && sweep < after);
  assert.match(production, /if: always\(\) && steps.release_before.outcome == 'success'/);
  assert.match(production, /name: Retain production page coverage\n\s+if: always\(\)/);
  assert.match(production, /page-qa-release\//);
  assert.doesNotMatch(production, /permissions:|environment:/);
});

test('production explicitly disables the session refresh write exception without changing staging', async () => {
  const production = workflow.slice(workflow.indexOf('  production-anonymous:'));
  assert.match(production, /QA_ANONYMOUS_READ_ONLY: '1'/);
  assert.match(sweep, /process\.env\.QA_ANONYMOUS_READ_ONLY !== '1'/);
  const routeSource = sweep.match(/await context\.route\('\*\*\/\*', (async \(route\) => \{[\s\S]*?)\n  \}\);/);
  assert.ok(routeSource, 'route guard must remain independently testable');
  for (const readOnly of [undefined, '1']) {
    const handler = runInNewContext(`(${routeSource[1]}\n})`, { URL, baseURL: 'https://veyrnox.ai', blockedWrites: [], process: { env: { QA_ANONYMOUS_READ_ONLY: readOnly } } });
    const classify = async (method, pathname, action = 'refresh', origin = 'https://veyrnox.ai') => handler({
      request: () => ({ url: () => `${origin}${pathname}`, method: () => method, postDataJSON: () => ({ action }) }),
      abort: () => 'blocked', continue: () => 'allowed',
    });
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(await classify(method, '/api/v1/jobs'), 'allowed');
    assert.equal(await classify('POST', '/api/auth/session'), readOnly === '1' ? 'blocked' : 'allowed');
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal(await classify(method, '/api/v1/jobs'), 'blocked');
    assert.equal(await classify('POST', '/api/auth/session', 'establish'), 'blocked');
    assert.equal(await classify('POST', '/api/auth/session', 'refresh', 'https://example.invalid'), 'blocked');
  }
});

const releaseHelper = () => import('../e2e/verify-live-release.mjs');
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const target = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', workflowSha: sha, expectedSha: sha };
const response = (html = `<script src="/_next/static/a.js?dpl=${sha}"></script>`, overrides = {}) => ({
  status: 200, redirected: false, url: 'https://veyrnox.ai/app?qa_release=1', headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
  text: async () => html, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(html)); controller.close(); } }), ...overrides,
});

test('production target requires manual main dispatch and an exact valid dispatch SHA before network access', async () => {
  const { assertProductionTarget, verifyProductionRelease } = await releaseHelper();
  assert.doesNotThrow(() => assertProductionTarget(target));
  for (const invalid of [{ eventName: 'schedule' }, { ref: 'refs/heads/feature' }, { expectedSha: '' },
    { expectedSha: '$(echo unsafe)' }, { expectedSha: 'A'.repeat(40) }, { workflowSha: otherSha }]) {
    assert.throws(() => assertProductionTarget({ ...target, ...invalid }));
    await assert.rejects(verifyProductionRelease({ ...target, ...invalid }, () => { assert.fail('invalid target must not fetch'); }));
  }
});

test('release proof uses only the fixed origin, disables redirects and bounds network time', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  const proof = await verifyProductionRelease(target, async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://veyrnox.ai');
    assert.equal(parsed.pathname, '/app');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    return response(`<script src="/_next/static/a?dpl=${sha}"></script><link href="/_next/static/b?dpl=${sha}">`);
  });
  assert.equal(proof.status, 200);
  assert.equal(proof.expectedSha, sha);
  assert.deepEqual(proof.releases, [sha]);
  assert.equal(proof.pathname, '/app');
  assert.equal(proof.url, undefined, 'proof must not retain query strings');
});

test('release checks reject missing, mixed, different and unsuccessful releases', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  for (const candidate of [response('no release'), response(`dpl=${otherSha}`), response(`dpl=${sha} dpl=${otherSha}`),
    response(undefined, { status: 503 }), response(undefined, { redirected: true }),
    response(undefined, { url: 'https://example.invalid/app' }), response(undefined, { url: 'https://veyrnox.ai/other' })]) {
    await assert.rejects(verifyProductionRelease(target, async () => candidate));
  }
});

test('release markers are exact URL query values on quoted same-origin Next assets, never prefixes or prose', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  for (const value of [`${sha}-suffix`, `${sha}%2Dsuffix`, `${sha}a`, `${sha}&amp;dpl=${otherSha}`]) {
    await assert.rejects(verifyProductionRelease(target, async () => response(`<script src="/_next/static/a.js?dpl=${value}"></script>`)));
  }
  for (const html of [`dpl=${sha}`, `<script src="https://example.invalid/_next/static/a.js?dpl=${sha}"></script>`, `<a href="/unrelated?dpl=${sha}">link</a>`, `<script data-src="/_next/static/a.js?dpl=${sha}"></script>`]) {
    await assert.rejects(verifyProductionRelease(target, async () => response(html)));
  }
  const proof = await verifyProductionRelease(target, async () => response(`<link href="/_next/static/a.css?other=1&amp;dpl=${sha}">`));
  assert.deepEqual(proof.releases, [sha]);
});

test('release HTML type and streamed byte ceiling fail closed before oversized bodies are accepted', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, { headers: new Headers({ 'content-type': 'application/json' }) })), /HTML/);
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, { headers: new Headers() })), /HTML/);
  const oversized = `<script src="/_next/static/a.js?dpl=${sha}"></script>${'x'.repeat(1024 * 1024)}`;
  await assert.rejects(verifyProductionRelease(target, async () => response(oversized)), /byte ceiling/);
  const partial = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(600 * 1024)); controller.enqueue(new Uint8Array(600 * 1024)); } });
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, { body: partial })), /byte ceiling/);
});

test('the overall deadline includes a stalled body, not just response headers', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  const body = new ReadableStream({ pull() { return new Promise(() => {}); } });
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, { body }), { timeoutMs: 5 }), /body read failed/);
});

test('the request deadline also bounds an unresponsive transport and cannot be raised above 30 seconds', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  await assert.rejects(verifyProductionRelease(target, () => new Promise(() => {}), { timeoutMs: 5 }), /request failed/);
  for (const timeoutMs of [0, 30_001, NaN]) await assert.rejects(verifyProductionRelease(target, async () => response(), { timeoutMs }), /deadline/);
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, { url: '' })), /destination/);
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, { body: null })), /body read failed/);
});

test('network, timeout and body failures are sanitized rather than leaking raw request details', async () => {
  const { verifyProductionRelease } = await releaseHelper();
  for (const error of [new Error('private detail'), new DOMException('private detail', 'TimeoutError')]) {
    await assert.rejects(verifyProductionRelease(target, async () => { throw error; }), { message: 'Production release request failed' });
  }
  await assert.rejects(verifyProductionRelease(target, async () => response(undefined, {
    text: async () => { throw new Error('private detail'); }, body: new ReadableStream({ start(controller) { controller.error(new Error('private detail')); } }),
  })),
    { message: 'Production release body read failed' });
});

test('release runner records successful before and after proofs, plus failure evidence before throwing', async () => {
  const { runProductionReleaseCheck } = await releaseHelper();
  const env = { GITHUB_EVENT_NAME: target.eventName, GITHUB_REF: target.ref, GITHUB_SHA: sha, QA_EXPECTED_SHA: sha };
  const written = [];
  const saveEvidence = async (phase, evidence) => written.push({ phase, evidence });
  for (const phase of ['before', 'after']) await runProductionReleaseCheck(phase, { env, fetchImpl: async () => response(), saveEvidence });
  await assert.rejects(runProductionReleaseCheck('after', { env, fetchImpl: async () => response(`dpl=${otherSha}`), saveEvidence }));
  assert.deepEqual(written.map(item => item.phase), ['before', 'after', 'after']);
  assert.equal(written[0].evidence.expectedSha, sha);
  assert.match(written[2].evidence.error, /release does not match/);
  await assert.rejects(runProductionReleaseCheck('unknown', { env, saveEvidence }), /phase/);
  await assert.rejects(runProductionReleaseCheck('before', { env, fetchImpl: async () => response(), saveEvidence: async () => { throw new Error('disk failure'); } }), /disk failure/);
});

test('release CLI fails closed and preserves a JSON proof without a valid production dispatch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'veyrnox-release-guard-test-'));
  try {
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../e2e/verify-live-release.mjs', import.meta.url)), 'before'], {
      cwd: directory, env: { ...process.env, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, QA_EXPECTED_SHA: sha }, stdio: 'pipe',
    }));
    const proof = JSON.parse(await readFile(path.join(directory, 'page-qa-release/before.json'), 'utf8'));
    assert.match(proof.error, /manual main dispatch/);
    assert.equal(proof.phase, 'before');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
