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
  assert.match(sweep, /\['\[data-storage-notice="analytics"\]', '\[data-storage-decline\]'\]/);
  assert.match(sweep, /\['\[data-storage-notice="essential"\]', '\[data-storage-dismiss\]'\]/);
  assert.match(sweep, /privacyChoices\.locator\(control\)\.click\(\)/);
});

test('every fixed storage notice the site can render has a handler using its own dismiss control', () => {
  // The two components that render a notice; each must be matched by the sweep, hook for hook.
  const sources = ['../components/PostHogManager.jsx', '../app/veyrnox/_components/SiteChrome.js']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  const variants = [...sources.matchAll(/data-storage-notice="([a-z]+)"/g)].map(([, name]) => name).sort();
  assert.deepEqual(variants, ['analytics', 'essential']);
  const handled = [...privacyHandlerSource().matchAll(/\['\[data-storage-notice="([a-z]+)"\]', '\[(data-storage-[a-z]+)\]'\]/g)];
  assert.deepEqual(handled.map(([, name]) => name).sort(), variants);
  for (const [, , control] of handled) assert.match(sources, new RegExp(`<button[^>]*\\s${control}\\s`), control);
});

function privacyHandlerSource() {
  const match = sweep.match(/async function handlePrivacyChoices\(page\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'privacy overlay handling must be installed before navigation, not probed only once');
  return match[0];
}

test('late privacy hydration is handled through the genuine Decline UI, not bypassed or consented', async () => {
  const source = privacyHandlerSource();
  assert.doesNotMatch(source, /localStorage|storageState|evaluate|force:|waitForTimeout|timeout:|noWaitAfter|Allow analytics|Analytics only/);
  const controls = { '[data-storage-notice="analytics"]': '[data-storage-decline]', '[data-storage-notice="essential"]': '[data-storage-dismiss]' };
  const visible = {};
  const handlers = {};
  const notices = {};
  const clicks = [];
  const page = { locator: (selector) => {
    assert.ok(controls[selector], `unexpected notice ${selector}`);
    notices[selector] = { selector, locator: (control) => {
      assert.equal(control, controls[selector], 'each notice is closed by its own control');
      return { click: async (...arguments_) => { assert.equal(visible[selector], true); assert.deepEqual(arguments_, []); clicks.push(control); visible[selector] = false; } };
    } };
    return notices[selector];
  }, addLocatorHandler: async (locator, callback, ...options) => {
    assert.equal(locator, notices[locator.selector]); assert.deepEqual(options, []); handlers[locator.selector] = callback;
  } };
  const install = runInNewContext(`(${source})`, { expect: locator => ({ toBeHidden: async () => { assert.equal(visible[locator.selector], false); } }) });
  await install(page);
  assert.deepEqual(Object.keys(handlers).sort(), Object.keys(controls).sort(), 'both fixed bottom notices are handled');
  assert.deepEqual(clicks, [], 'an absent banner must not cause a click or storage write');
  for (const selector of Object.keys(controls)) {
    visible[selector] = true; // Hydration occurs after setup: the handler remains registered.
    await handlers[selector](notices[selector]);
    assert.equal(visible[selector], false, 'the normal gallery action can now proceed without forcing it');
  }
  assert.deepEqual(clicks, ['[data-storage-decline]', '[data-storage-dismiss]']);
});

test('a broken Decline control stays a failure rather than being retried or hidden by the harness', async () => {
  let handler;
  let clicks = 0;
  const privacy = { locator: () => ({ click: async () => { clicks++; throw new Error('Decline control failed'); } }) };
  const install = runInNewContext(`(${privacyHandlerSource()})`, { expect: () => assert.fail('failed Decline cannot assert successful dismissal') });
  await install({ locator: () => privacy, addLocatorHandler: async (_, callback) => { handler = callback; } });
  await assert.rejects(handler(privacy), /Decline control failed/);
  assert.equal(clicks, 1);
});

test('replacement pages receive their own privacy locator and callback, never a stale page closure', async () => {
  const callbacks = [];
  const selected = [];
  const install = runInNewContext(`(${privacyHandlerSource()})`, { expect: locator => ({ toBeHidden: async () => selected.push(`hidden:${locator.id}`) }) });
  for (const id of ['original', 'replacement']) {
    const locator = { id, locator: () => ({ click: async () => selected.push(`decline:${id}`) }) };
    await install({ locator: () => locator, addLocatorHandler: async (_, callback) => callbacks.push(callback) });
  }
  assert.equal(callbacks.length, 4, 'two notices on each of the two pages');
  await callbacks[2]();
  await callbacks[0]();
  assert.deepEqual(selected, ['decline:replacement', 'hidden:replacement', 'decline:original', 'hidden:original']);
});

test('privacy handler is installed before navigation and on replacement pages without weakening gallery checks', () => {
  assert.match(sweep, /await handlePrivacyChoices\(page\);/);
  assert.ok(sweep.indexOf('await handlePrivacyChoices(page);') < sweep.indexOf('await page.goto'));
  assert.match(sweep, /page = await context.newPage\(\);\s+await handlePrivacyChoices\(page\);/);
  assert.doesNotMatch(sweep, /if \(await privacyChoices\.isVisible\(\)\)/);
  assert.match(sweep, /getByRole\('button', \{ name: 'Show more templates' \}\)\.click\(\)/);
  assert.match(sweep, /const GALLERY_BATCH = 50;/);
  assert.doesNotMatch(sweep, /const before = await .*\.count\(\)/, 'a non-waiting count read before the client batch renders is 0');
  const firstBatch = sweep.indexOf("await expect(cards, 'first gallery batch renders').toHaveCount(GALLERY_BATCH);");
  const more = sweep.indexOf("getByRole('button', { name: 'Show more templates' }).click()");
  const secondBatch = sweep.indexOf('await expect(cards).toHaveCount(GALLERY_BATCH * 2);');
  assert.ok(firstBatch >= 0 && firstBatch < more && more < secondBatch, 'wait for the first batch, then ask for more, then expect two batches');
  assert.match(sweep, /const cards = page\.locator\('#preset-gallery-results > a'\);/);
  assert.match(sweep, /locator\('#preset-gallery-results img'\)\.count\(\), 'first gallery batch is bounded'\)\.toBeLessThanOrEqual\(GALLERY_BATCH\)/);
  assert.match(sweep, /expect\(metrics\.images, 'first gallery page is bounded'\)\.toBeLessThanOrEqual\(110\)/);
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
  assert.match(workflow, /QA_REPORT_DIR: page-coverage-report\/authenticated/);
  assert.match(workflow, /name: page-qa-authenticated/);
  assert.doesNotMatch(workflow, /path:.*\.scratch\/qa-session/);
});

test('each authenticated project sweeps from its own freshly created session, never a shared one', () => {
  // The refresh cookie rotates on first use: a second project given the same saved state starts signed out.
  const staging = workflow.slice(0, workflow.indexOf('  production-anonymous:'));
  const prepare = staging.slice(staging.indexOf('id: auth_session'), staging.indexOf('name: Sweep every page on authenticated desktop'));
  const sweeps = [...staging.matchAll(/QA_STORAGE_STATE: (\S+)\n\s+QA_REPORT_DIR: (\S+)\n\s+run: npx playwright test -c e2e\/page-coverage\.config\.mjs((?: --project \S+)+) --output (\S+)/g)]
    .map(([, state, report, projects, output]) => ({ state, report, projects: projects.trim(), output }));
  assert.deepEqual(sweeps, [
    { state: '.scratch/qa-session-desktop.json', report: 'page-coverage-report/authenticated/desktop', projects: '--project desktop-authenticated', output: 'test-results/page-qa-authenticated/desktop' },
    { state: '.scratch/qa-session-mobile.json', report: 'page-coverage-report/authenticated/mobile', projects: '--project mobile-authenticated', output: 'test-results/page-qa-authenticated/mobile' },
  ]);
  for (const { state } of sweeps) assert.ok(prepare.includes(`QA_STORAGE_STATE=${state} node e2e/create-qa-state.mjs`), state);
  assert.equal((prepare.match(/node e2e\/create-qa-state\.mjs/g) || []).length, 2);
  assert.equal((staging.match(/if: always\(\) && steps\.auth_session\.outcome == 'success'/g) || []).length, 3, 'both sweeps and the artifact wait on the sessions');
  // The artifact keeps both reports and both outputs, and no path can reach a storage state.
  const artifact = staging.slice(staging.indexOf('name: Retain authenticated page coverage'));
  assert.match(artifact, /path: \|\n\s+page-coverage-report\/authenticated\/\n\s+test-results\/page-qa-authenticated\/\n/);
  assert.doesNotMatch(workflow, /include-hidden-files/);
  for (const [, block] of workflow.matchAll(/path: \|\n((?:\s{12}\S.*\n)+)/g)) assert.doesNotMatch(block, /\.scratch|qa-session|\.json/);
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
  const plain = (list) => [...list].map(item => ({ ...item }));
  const errors = [{ url: 'https://veyrnox.ai/app/oddlings', message: 'Editor hydration failed\n    at https://veyrnox.ai/_next/static/editor.js:1:20' }];
  assert.deepEqual(plain(details(errors, { sensitive: false })), errors);
  const privatePath = '/app/projects/private-project-id?revision=4';
  const redacted = details([{ url: `https://staging.invalid${privatePath}`, message: `Could not render ${privatePath}\n at ${privatePath}` }], {
    sensitive: true, pathname: privatePath, template: '/app/projects/[id]',
  });
  assert.deepEqual(plain(redacted), [{ url: 'https://staging.invalid/app/projects/[id]', message: 'Could not render /app/projects/[id]\n at /app/projects/[id]' }]);
  assert.deepEqual(plain(details([{ url: 'https://staging.invalid/social/review/synthetic-token#top',
    message: 'Review failed at /social/review/synthetic-token?qa=1\n at https://staging.invalid/social/review/synthetic-token:1:20',
  }], { sensitive: true, pathname: '/social/review/synthetic-token?qa=1', template: '/social/review/[token]' })), [{
    url: 'https://staging.invalid/social/review/[token]#top',
    message: 'Review failed at /social/review/[token]\n at https://staging.invalid/social/review/[token]:1:20',
  }]);
  assert.deepEqual(plain(details([], { sensitive: false })), []);
  assert.match(sweep, /errors\.push\(\{ url: watched\.url\(\), message: error\.stack \|\| error\.message \}\)/);
  assert.match(sweep, /finally \{\s+result\.browserErrors = browserErrorDetails\(errors, entry\);\s+watched\.off\('pageerror', onError\)/);
});

test('an error is recorded against the document that raised it, never the next page', () => {
  // The previous document is unloaded before this entry's listener is attached, on the same page object.
  assert.match(sweep, /const watched = page;\n\s+const onError = [^\n]+\n(?:\s+\/\/[^\n]*\n)*\s+await watched\.goto\('about:blank'\);\n\s+watched\.on\('pageerror', onError\);/);
  const blank = sweep.indexOf("await watched.goto('about:blank')");
  const listen = sweep.indexOf("watched.on('pageerror', onError)");
  const navigate = sweep.indexOf('await page.goto(entry.pathname');
  assert.ok(blank >= 0 && blank < listen && listen < navigate);
  assert.equal((sweep.match(/\.on\('pageerror'/g) || []).length, 1);
});

test('a dark route is a controlled 200 or 404 and never a tolerated server error', () => {
  const outcome = runInNewContext(`(${authFunction('darkRouteOutcome')})`, { Error });
  assert.equal(outcome(200), 'render');
  assert.equal(outcome(404), 'dark');
  for (const status of [0, 204, 301, 401, 403, 500, 502, 503]) assert.throws(() => outcome(status), /Dark route answered/, String(status));
  // The status is read without a browser navigation first: Chromium rejects page.goto on an empty 404.
  assert.match(sweep, /entry\.mode === 'dark-route' && darkRouteOutcome\(\(await request\.get\(entry\.pathname\)\)\.status\(\)\) === 'dark'/);
  assert.match(sweep, /if \(error\.message\.includes\('ERR_HTTP_RESPONSE_CODE_FAILURE'\)\) return 404;\n\s+throw error;/);
  assert.match(sweep, /expect\(darkStatus, [^)]+\)\.toBe\(404\);\n\s+expect\(errors\.length, `uncaught errors on dark route: \$\{label\}`\)\.toBe\(0\);\n\s+return;/);
  const dark = sweep.indexOf("entry.mode === 'dark-route'");
  assert.ok(dark > sweep.indexOf("watched.on('pageerror', onError)") && dark < sweep.indexOf('const res = await page.goto(entry.pathname'));
  // Switched on, the route falls through to the ordinary render assertions.
  assert.match(sweep, /expect\(status, label\)\.toBe\(200\);/);
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
