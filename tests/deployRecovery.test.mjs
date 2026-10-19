import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { siteIsDown } from '../scripts/check-site-health.mjs';

const run = promisify(execFile);
const root = new URL('../', import.meta.url).pathname;
const deploy = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const step = (name) => {
    const at = deploy.indexOf(`- name: ${name}`);
    assert.notEqual(at, -1, `no step named ${name}`);
    const next = deploy.indexOf('\n      - ', at + 1);
    return deploy.slice(at, next === -1 ? undefined : next);
};

// 2026-10-19: the live site returned 500, the capture step needs a healthy
// site, and so the revert that would have fixed it could not deploy.
test('siteIsDown is true only when every failure is a 5xx or unreachable', () => {
    const base = { problems: ['x'], unreachable: 0, serverErrors: 0, otherFailures: 0 };
    assert.equal(siteIsDown({ ...base, serverErrors: 3 }), true);
    assert.equal(siteIsDown({ ...base, unreachable: 6 }), true);
    assert.equal(siteIsDown({ ...base, serverErrors: 3, otherFailures: 1 }), false, 'a 404 on a live site stays strict');
    assert.equal(siteIsDown({ ...base, problems: [] }), false, 'a healthy site is not down');
});

// A stand-in for the live site, on 127.0.0.1.
async function withSite(handler, fn) {
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
const healthy = (req, res) => {
    const path = req.url.split('?')[0];
    const pages = {
        '/': ['text/html', '<html>Veyrnox <script src="/_next/static/a.js"></script></html>', 200],
        '/pricing': ['text/html', 'Veyrnox', 200],
        '/tools': ['text/html', 'Bring your own file', 200],
        '/robots.txt': ['text/plain', 'Sitemap: x', 200],
        '/sitemap.xml': ['application/xml', '<urlset></urlset>', 200],
        '/api/v1/health': ['application/json', '{"error":"unauthorized"}', 401],
    };
    const [type, body, status] = pages[path] || ['text/plain', 'nope', 404];
    res.writeHead(status, { 'content-type': type });
    res.end(body);
};
const capture = async (base, extra = []) => {
    const out = join(mkdtempSync(join(tmpdir(), 'cap-')), 'assets.json');
    const result = await run('node', ['scripts/check-site-health.mjs', '--capture-assets', out, ...extra], {
        cwd: root, env: { ...process.env, SITE_HEALTH_BASE_URL: base, SITE_HEALTH_RETRY_DELAY_MS: '10' },
    }).then((r) => ({ code: 0, ...r }), (e) => e);
    return { result, manifest: result.code === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null };
};

test('capture against a 500 site: strict by default, tolerated with the flag', { timeout: 120_000 }, async () => {
    await withSite((req, res) => { res.writeHead(500); res.end('boom'); }, async (base) => {
        const strict = await capture(base);
        assert.notEqual(strict.result.code, 0, 'without the flag a down site still fails capture');
        const tolerant = await capture(base, ['--tolerate-server-errors']);
        assert.equal(tolerant.result.code, 0);
        assert.deepEqual(tolerant.manifest, { version: 1, degraded: true, assets: [] });
        assert.match(tolerant.result.stdout, /^::warning::.*unhealthy/m);
    });
});

test('capture against a healthy site is unchanged, flag or not', { timeout: 60_000 }, async () => {
    await withSite(healthy, async (base) => {
        for (const extra of [[], ['--tolerate-server-errors']]) {
            const { result, manifest } = await capture(base, extra);
            assert.equal(result.code, 0);
            assert.deepEqual(manifest, { version: 1, assets: ['/_next/static/a.js'] });
        }
    });
});

test('a live site that is up but wrong is not tolerated', { timeout: 120_000 }, async () => {
    await withSite((req, res) => {
        if (req.url.startsWith('/tools')) { res.writeHead(404); return res.end('missing'); }
        healthy(req, res);
    }, async (base) => {
        const { result } = await capture(base, ['--tolerate-server-errors']);
        assert.notEqual(result.code, 0);
    });
});

test('the workflow wires recovery: input, tolerant capture, non-retained smoke, no rollback', () => {
    assert.match(deploy, /workflow_dispatch:\n\s+inputs:[\s\S]*force_recovery:[\s\S]*type: boolean[\s\S]*default: false/);
    assert.match(deploy, /FORCE_RECOVERY: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.force_recovery && 'true' \|\| 'false' \}\}/);
    assert.match(step('Retain previous Next static assets'), /env\.FORCE_RECOVERY != 'true'/);
    const capture = step('Record currently referenced production assets');
    assert.match(capture, /--capture-assets previous-build-assets\.json --tolerate-server-errors/);
    assert.match(capture, /echo "degraded=true" >> "\$GITHUB_OUTPUT"/);
    const recovery = step('Decide whether this is a recovery deploy');
    assert.match(recovery, /::warning::RECOVERY DEPLOY/);
    assert.match(step('Smoke test the live site with retained assets'), /steps\.recovery\.outputs\.active != 'true'/);
    assert.match(step('Smoke test the first retention-enabled deploy'), /steps\.recovery\.outputs\.active == 'true'/);
    assert.match(step('Roll back to the recorded deployment'), /steps\.recovery\.outputs\.active != 'true'/);
    assert.match(step('No rollback in a recovery deploy'), /steps\.recovery\.outputs\.active == 'true'/);
});

test('the ci-green wait still applies to a forced recovery', () => {
    assert.match(deploy, /deploy:\n\s+needs: ci-green/);
    assert.equal(/ci-green:\n(?:.*\n){0,4}\s+if:.*FORCE_RECOVERY|ci-green:\n(?:.*\n){0,4}\s+if:.*force_recovery/.test(deploy), false);
});

test('protections the recovery path must keep are still in place', () => {
    assert.match(deploy, /node scripts\/check-worker-secrets\.mjs capture previous-secrets\.json/);
    assert.match(deploy, /node scripts\/check-worker-secrets\.mjs verify previous-secrets\.json/);
    assert.match(deploy, /node scripts\/check-workers-dev\.mjs/);
    assert.match(step('Verify live secret bindings survived'), /if: env\.HAS_TOKEN == 'true' && steps\.tip\.outputs\.stale != 'true'\n/);
});

test('a failed rollback with a 4xx names the last known-good deployment', () => {
    const rollback = step('Roll back to the recorded deployment');
    assert.match(rollback, /-w '\\n%\{http_code\}\\n'/);
    assert.match(rollback, /ROLLBACK FAILED after deploying \$GITHUB_SHA \(HTTP \$\{code:-unknown\}\)/);
    assert.match(rollback, /case "\$code" in\n\s+4\*\)[\s\S]*LAST_GOOD/);
    assert.match(step('Find the last known-good deployment'), /bash scripts\/last-known-good\.sh/);
    assert.match(deploy, /last_good: \$\{\{ steps\.lkg\.outputs\.summary \}\}/);
    assert.match(deploy.slice(deploy.indexOf('\n  report-failure:')), /LAST_GOOD: \$\{\{ needs\.deploy\.outputs\.last_good \}\}/);
    const record = step('Record this release as last known-good');
    assert.match(record, /continue-on-error: true/);
    assert.match(record, /success\(\)/);
    assert.match(deploy, /name: last-good-deployment/);
});

test('last-known-good.sh reads the newest unexpired record and never fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lkg-'));
    const record = join(dir, 'rec.json');
    writeFileSync(record, JSON.stringify({ sha: 'abc1234', run_id: '42', recorded_at: '2026-10-18T10:00:00Z', versions: [{ version_id: 'v1', percentage: 100 }] }));
    // A stand-in gh: run 100 has no artifact, run 99 has one.
    const gh = join(dir, 'gh');
    writeFileSync(gh, `#!/usr/bin/env bash
case "$1 $2" in
  "run list") printf '100\\n99\\n' ;;
  "api repos/o/r/actions/runs/100/artifacts") ;;
  "api repos/o/r/actions/runs/99/artifacts") echo 777 ;;
  "run download") d=""; while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && d="$2"; shift; done; cp "${record}" "$d/last-good-deployment.json" ;;
esac
`);
    chmodSync(gh, 0o755);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: join(dir, 'out') };
    const { stdout } = await run('bash', ['scripts/last-known-good.sh'], { cwd: root, env });
    assert.match(stdout, /commit abc1234 \(run 42, smoke-passed 2026-10-18T10:00:00Z\), Worker versions \[\{"version_id":"v1","percentage":100\}\]/);
    assert.match(readFileSync(join(dir, 'out'), 'utf8'), /^summary=Last known-good deployment: commit abc1234/);
    // Nothing recorded: still exit 0 with a plain sentence.
    writeFileSync(gh, '#!/usr/bin/env bash\nexit 1\n');
    const none = await run('bash', ['scripts/last-known-good.sh'], { cwd: root, env });
    assert.match(none.stdout, /No last known-good deployment record found/);
});

// Dry run of the rollback block's curl against a stand-in that answers 400,
// as Cloudflare did for the expired version 2a41e9cd.
test('the rollback request keeps the status code when the target is refused', { timeout: 30_000 }, async () => {
    await withSite((req, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"success":false}'); }, async (base) => {
        const dir = mkdtempSync(join(tmpdir(), 'rb-'));
        writeFileSync(join(dir, 'rollback.json'), '{}');
        let curl = step('Roll back to the recorded deployment').match(/if ! (curl[\s\S]*?) > rollback-response\.txt; then/)[1];
        curl = curl.replace('--retry 4', '--retry 0').replace(/\\\n/g, ' ').replace('"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/deployments"', `"${base}/"`);
        await assert.rejects(run('bash', ['-c', `${curl} > rollback-response.txt`], { cwd: dir, env: { ...process.env, CLOUDFLARE_API_TOKEN: 't' } }));
        assert.equal(readFileSync(join(dir, 'rollback-response.txt'), 'utf8').trim().split('\n').pop(), '400');
    });
});
