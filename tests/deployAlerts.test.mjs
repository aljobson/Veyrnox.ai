import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploy = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');

// 2026-10-03: ci went red on main, ci-green refused the deploy of #448, and
// no issue was opened because report-failure only watched the deploy job.
test('a deploy refused by red ci opens a deploy-failure issue, as a failed deploy does', () => {
    const job = deploy.slice(deploy.indexOf('\n  report-failure:'));
    assert.match(job, /needs: \[ci-green, deploy\]/);
    assert.match(job, /if: failure\(\) && \(needs\.ci-green\.result == 'failure' \|\| needs\.deploy\.result == 'failure'\)/);
    assert.match(job, /CI_GREEN: \$\{\{ needs\.ci-green\.result \}\}/);
    assert.match(job, /Production deploy refused/);
    assert.match(job, /Production deploy failed/);
    assert.match(job, /issues: write/);
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
});
