// wrangler.jsonc keeps the production Worker off workers.dev and Preview URLs
// (ADR-0078). wrangler applies both on `wrangler deploy` and nowhere else, so
// deploy-production reads them back after each deploy and says so if either
// is on. The check reports; it never fails the deploy or stands in the way of
// the smoke test and its rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessSubdomain, checkWorkersDev, annotation } from '../scripts/check-workers-dev.mjs';

const TOKEN = 'cf-token-test-only';
const ARGS = { accountId: 'acc123', workerName: 'veyrnox-ai', token: TOKEN, delayMs: 0 };
const answer = (result, over = {}) => ({ success: true, errors: [], messages: [], result, ...over });

test('the two settings are read from the API answer as documented', () => {
    assert.deepEqual(assessSubdomain(answer({ enabled: false, previews_enabled: false })),
        { state: 'closed', detail: 'the workers.dev route and Preview URLs are off' });
    assert.deepEqual(assessSubdomain(answer({ enabled: true, previews_enabled: false })),
        { state: 'open', detail: 'the workers.dev route is on' });
    assert.deepEqual(assessSubdomain(answer({ enabled: false, previews_enabled: true })),
        { state: 'open', detail: 'Preview URLs are on' });
    assert.deepEqual(assessSubdomain(answer({ enabled: true, previews_enabled: true })),
        { state: 'open', detail: 'the workers.dev route is on and Preview URLs are on' });
    // One setting on is enough, whatever the other says.
    assert.equal(assessSubdomain(answer({ enabled: true })).state, 'open');
});

test('an answer that does not say on or off for both is unknown, never off', () => {
    const unclear = [
        null, undefined, 'ok', [], {}, answer(null), answer('false'), answer({}),
        answer({ enabled: false }), answer({ previews_enabled: false }),
        answer({ enabled: 'false', previews_enabled: 'false' }), answer({ enabled: 0, previews_enabled: 0 }),
        answer({ enabled: false, previews_enabled: false }, { success: false }),
        { result: { enabled: false, previews_enabled: false } },
    ];
    for (const body of unclear) assert.equal(assessSubdomain(body).state, 'unknown', JSON.stringify(body));
});

test('one GET to the Worker\'s subdomain setting, with the token as a bearer', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push([String(url), init]); return Response.json(answer({ enabled: false, previews_enabled: false })); };
    assert.equal((await checkWorkersDev({ ...ARGS, fetchImpl })).state, 'closed');
    assert.equal(calls.length, 1);
    const [url, init] = calls[0];
    assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/acc123/workers/scripts/veyrnox-ai/subdomain');
    assert.equal(init.method ?? 'GET', 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('a refusal, a junk body or an unreachable API is unknown after every attempt, and nothing is thrown', async () => {
    const failures = [
        [async () => new Response('{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}', { status: 403 }), /the API answered 403/],
        [async () => new Response('<html>', { status: 200 }), /could not be read/],
        [async () => { throw new TypeError('fetch failed'); }, /could not be read \(TypeError\)/],
        [async () => Response.json(answer({ enabled: false })), /did not say on or off/],
    ];
    for (const [respond, detail] of failures) {
        let calls = 0;
        const out = await checkWorkersDev({ ...ARGS, attempts: 3, fetchImpl: async (...a) => { calls++; return respond(...a); } });
        assert.equal(out.state, 'unknown');
        assert.match(out.detail, detail);
        assert.equal(calls, 3);
        assert.equal(JSON.stringify(out).includes(TOKEN), false);
        assert.equal(/[\r\n]/.test(out.detail), false);
    }
});

test('a transient failure recovers on retry, and an open answer is not retried', async () => {
    let calls = 0;
    const flaky = async () => (calls++ === 0 ? new Response('busy', { status: 503 }) : Response.json(answer({ enabled: false, previews_enabled: false })));
    assert.equal((await checkWorkersDev({ ...ARGS, fetchImpl: flaky })).state, 'closed');
    assert.equal(calls, 2);

    calls = 0;
    const open = async () => { calls++; return Response.json(answer({ enabled: true, previews_enabled: true })); };
    assert.equal((await checkWorkersDev({ ...ARGS, fetchImpl: open })).state, 'open');
    assert.equal(calls, 1);
});

test('without its three values the check says so and calls nothing', async () => {
    const fetchImpl = async () => assert.fail('the API was called');
    for (const missing of ['accountId', 'workerName', 'token']) {
        const out = await checkWorkersDev({ ...ARGS, [missing]: '', fetchImpl });
        assert.equal(out.state, 'unknown', missing);
        assert.equal(JSON.stringify(out).includes(TOKEN), false);
    }
});

test('the log line is a plain line when off, a warning when unknown and an error when on', () => {
    assert.equal(annotation('veyrnox-ai', { state: 'closed', detail: 'the workers.dev route and Preview URLs are off' }),
        'veyrnox-ai: the workers.dev route and Preview URLs are off.');
    assert.match(annotation('veyrnox-ai', { state: 'open', detail: 'Preview URLs are on' }), /^::error::veyrnox-ai: Preview URLs are on\b/);
    assert.match(annotation('veyrnox-ai', { state: 'unknown', detail: 'the API answered 403' }), /^::warning::.*veyrnox-ai.*the API answered 403/);
});

const workflow = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'), workflow.indexOf('\n  report-failure:'));
const stepAt = (name) => {
    const at = deployJob.indexOf(`- name: ${name}`);
    assert.notEqual(at, -1, `no step named ${name}`);
    const next = deployJob.indexOf('\n      - ', at + 1);
    return { at, text: deployJob.slice(at, next === -1 ? undefined : next) };
};

test('the check runs after the smoke test and its rollback, and cannot fail the deploy job', () => {
    const deploy = stepAt('Deploy');
    const smoke = stepAt('Smoke test the live site');
    const rollback = stepAt('Roll back to the recorded deployment');
    const check = stepAt('Is the Worker still off workers.dev?');
    assert.match(deploy.text, /\n        id: deploy\n/);
    assert.ok(deploy.at < smoke.at && smoke.at < rollback.at && rollback.at < check.at, 'step order');
    // It reads back what this run's deploy set, whether or not the smoke test passed.
    assert.match(check.text, /\n        if: \$\{\{ !cancelled\(\) && steps\.deploy\.outcome == 'success' \}\}\n/);
    assert.match(check.text, /\n        continue-on-error: true\n/);
    assert.match(check.text, /\n        run: node scripts\/check-workers-dev\.mjs\n/);
    assert.match(check.text, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    // The steps that decide a rollback are as they were.
    assert.match(smoke.text, /\n        id: smoke\n        if: env\.HAS_TOKEN == 'true' && steps\.tip\.outputs\.stale != 'true'\n        run: sleep 20 && node scripts\/check-site-health\.mjs\n/);
    assert.match(rollback.text, /\n        if: failure\(\) && steps\.smoke\.outcome == 'failure'\n/);
});

test('an open or unreadable setting is reported on the deploy-failure issue by its own job', () => {
    // A check that crashed counts as unreadable, so it cannot go quiet.
    assert.match(deployJob, /\n    outputs:\n      workers_dev: \$\{\{ steps\.workers_dev\.outputs\.state \|\| \(steps\.workers_dev\.outcome == 'failure' && 'unknown'\) \|\| '' \}\}\n/);
    const job = workflow.slice(workflow.indexOf('\n  report-workers-dev:'));
    // After report-failure, so the two jobs cannot each open an issue.
    assert.match(job, /\n    needs: \[deploy, report-failure\]\n/);
    assert.match(job, /\n    if: always\(\) && \(needs\.deploy\.outputs\.workers_dev == 'open' \|\| needs\.deploy\.outputs\.workers_dev == 'unknown'\)\n/);
    assert.match(job, /issues: write/);
    assert.match(job, /--label deploy-failure/);
    // Values reach the shell through the environment, never by interpolation.
    assert.match(job, /STATE: \$\{\{ needs\.deploy\.outputs\.workers_dev \}\}/);
    assert.equal(/run: \|[\s\S]*\$\{\{/.test(job), false, 'an expression inside a run block');
    // Only that job may write issues; the deploy job holds the Cloudflare token.
    assert.equal(/issues: write/.test(deployJob), false);
});
