import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploy = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('the production gate waits longer than the CI build-test budget', () => {
    const buildMinutes = Number(ci.match(/build-test:\n[\s\S]*?timeout-minutes: (\d+)/)?.[1]);
    const gateMinutes = Number(deploy.match(/ci-green:\n[\s\S]*?timeout-minutes: (\d+)/)?.[1]);
    const polls = Number(deploy.match(/for _ in \$\(seq 1 (\d+)\)/)?.[1]);
    assert.equal(buildMinutes, 30, 'CI needs headroom for slow Ubuntu package mirrors');
    assert.equal(gateMinutes, 45, 'the deployment gate needs slack beyond CI');
    assert.equal(polls * 30 / 60, gateMinutes, 'the polling window matches the job timeout');
});

// 2026-10-03: ci went red on main, ci-green refused the deploy of #448, and
// no issue was opened because report-failure only watched the deploy job.
test('a deploy refused by red ci opens a deploy-failure issue, as a failed deploy does', () => {
    const job = deploy.slice(deploy.indexOf('\n  report-failure:'));
    assert.match(job, /needs: \[ci-green, deploy, authed-smoke\]/);
    assert.match(job, /if: failure\(\) && \(needs\.ci-green\.result == 'failure' \|\| needs\.deploy\.result == 'failure' \|\| needs\.authed-smoke\.result == 'failure'\)/);
    assert.match(job, /CI_GREEN: \$\{\{ needs\.ci-green\.result \}\}/);
    assert.match(job, /Production deploy refused/);
    assert.match(job, /Production deploy failed/);
    assert.match(job, /issues: write/);
});

test('a verified production deploy closes every resolved deploy-failure incident', () => {
    assert.match(deploy, /deployed: \$\{\{ steps\.deploy\.outcome == 'success' && 'true' \|\| 'false' \}\}/);
    const job = deploy.slice(deploy.indexOf('\n  resolve-failure:'));
    assert.match(job, /needs: \[deploy, authed-smoke, report-failure, report-workers-dev\]/);
    assert.match(job, /needs\.authed-smoke\.result != 'failure'/);
    assert.match(job, /needs\.deploy\.result == 'success'/);
    assert.match(job, /needs\.deploy\.outputs\.deployed == 'true'/);
    assert.match(job, /needs\.deploy\.outputs\.workers_dev == 'closed'/);
    assert.match(job, /gh issue list --label deploy-failure --state open --limit 100/);
    assert.match(job, /gh issue close "\$number" --reason completed/);
    assert.match(job, /Resolved by verified production deploy/);
});

// The signed-in smoke test alerts but does not roll back, runs in its own job
// so the service-role key never shares one with npm ci or the deploy, and
// fails closed once a smoke user is configured.
test('the signed-in smoke test is a separate, alert-only, fail-closed job', () => {
    const start = deploy.indexOf('\n  authed-smoke:');
    // Comments explain the design and mention npm ci; only the steps count.
    const job = deploy.slice(start, deploy.indexOf('\n  report-failure:'))
        .split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
    assert.match(job, /needs: deploy/);
    assert.match(job, /needs\.deploy\.result == 'success' && needs\.deploy\.outputs\.deployed == 'true'/);
    assert.match(job, /environment: production/);
    assert.match(job, /node scripts\/check-authed-smoke\.mjs/);
    assert.doesNotMatch(job, /npm (ci|install)/);
    assert.doesNotMatch(job, /rollback/i);
    // The service-role key is passed to the one step that runs the script, not job-wide.
    assert.equal((job.match(/SUPABASE_SERVICE_ROLE_KEY/g) || []).length, 2);
    assert.match(job, /SMOKE_USER_EMAIL: \$\{\{ vars\.SMOKE_USER_EMAIL \}\}/);
    assert.match(job, /Skip until a smoke user is configured/);
});

// 2026-10-09 (#753): one 504 from the Cloudflare API, 55 s into the read that
// records the rollback target, failed a deploy. The rollback is the same kind
// of single request, and the one that matters most.
const step = (name) => {
    const at = deploy.indexOf(`- name: ${name}`);
    assert.notEqual(at, -1, `no step named ${name}`);
    const next = deploy.indexOf('\n      - ', at + 1);
    return deploy.slice(at, next === -1 ? undefined : next);
};
const TRIES = /curl -f --no-progress-meter --retry 4 --retry-all-errors --max-time 10 --retry-max-time 45 \\\n/;

test('the read that records the rollback target is tried again, into a file', () => {
    const record = step('Record the live deployment');
    assert.match(record, TRIES);
    // A retry starts the file again; a pipe would hand jq both answers.
    assert.match(record, / -o live-deployments\.json \\\n/);
    assert.equal(/\\\n\s*\| jq/.test(record), false, 'curl is piped into jq');
    assert.match(record, /live-deployments\.json > previous-deployment\.json\n/);
    assert.match(record, /jq -e '\.versions \| length > 0' previous-deployment\.json/);
});

test('the rollback request is tried again, and says so when it still fails', () => {
    const rollback = step('Roll back to the recorded deployment');
    assert.match(rollback, new RegExp(`if ! ${TRIES.source}\\s+-X POST `));
    assert.match(rollback, /--data @rollback\.json \\\n/);
    const failed = rollback.indexOf('::error::ROLLBACK FAILED after deploying $GITHUB_SHA');
    const rolledBack = rollback.indexOf('rolled back to $(jq -c .versions previous-deployment.json)');
    assert.ok(failed !== -1 && failed < rolledBack, 'a failed rollback is not reported as done');
    assert.match(rollback.slice(failed, rolledBack), /\n\s+exit 1\n\s+fi\n/);
    // The issue is opened either way, so its text must not say the rollback happened when it did not.
    const report = deploy.slice(deploy.indexOf('\n  report-failure:'));
    assert.match(report, /rolled production back to the previously live version, unless the run log says ROLLBACK FAILED;/);
    assert.equal(/was rolled back automatically/.test(report), false);
});
