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
