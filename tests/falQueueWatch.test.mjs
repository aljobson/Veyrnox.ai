import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/fal-queue-watch-staging.yml', import.meta.url), 'utf8');
const script = workflow.slice(workflow.lastIndexOf('        run: |\n') + '        run: |\n'.length)
    .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');

test('scheduled checker isolates read-only monitoring credentials and gates issue writes separately', () => {
    assert.match(workflow, /cron: '4,14,24,34,44,54 \* \* \* \*'/);
    assert.match(workflow, /github.ref == 'refs\/heads\/main' && vars.FAL_QUEUE_STAGING_WATCH_ENABLED == 'true'/);
    assert.match(workflow, /environment: fal-queue-monitor-staging/);
    assert.match(workflow, /secrets.CLOUDFLARE_QUEUE_MONITOR_TOKEN/);
    assert.match(workflow, /vars.FAL_QUEUE_STAGING_ISSUES_ENABLED == 'true'/);
    // Catch failures before a report exists, not just checker exit 1/2.
    assert.match(workflow, /needs.check.result == 'failure'/);
    assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|FAL_KEY|secrets.CLOUDFLARE_API_TOKEN|wrangler|pull_request_target/);
});

test('incident shell creates once, stays quiet when unchanged, updates changes and covers absent reports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fal-watch-'));
    try {
        writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const dir = process.env.GH_MOCK_DIR;
fs.appendFileSync(path.join(dir, 'calls'), JSON.stringify(args) + '\\n');
const body = path.join(dir, 'body');
if (args[0] === 'label') process.exit(0);
if (args[1] === 'list') { process.stdout.write(fs.existsSync(body) ? '12\\n' : '\\n'); process.exit(0); }
if (args[1] === 'view') { process.stdout.write(fs.readFileSync(body, 'utf8')); process.exit(0); }
if (args[1] === 'create' || args[1] === 'edit') {
  fs.copyFileSync(args[args.indexOf('--body-file') + 1], body);
  fs.appendFileSync(path.join(dir, 'writes'), args[1] + '\\n');
  process.exit(0);
}
process.exit(99);
`, { mode: 0o755 });
        const run = (report, testMode = 'false') => {
            const result = spawnSync('bash', ['-c', script], {
                encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
                    GH_MOCK_DIR: dir, RUNNER_TEMP: dir, REPORT: report, GH_TOKEN: 'test-only',
                    GH_REPO: 'test/fixture', RUN_URL: 'https://example.test/run', TEST_MODE: testMode },
            });
            assert.equal(result.status, 0, result.stderr);
        };
        run('DLQ backlog=1');
        run('DLQ backlog=1');
        assert.equal(readFileSync(join(dir, 'writes'), 'utf8'), 'create\n');
        const literal = `DLQ backlog=2; $(touch ${join(dir, 'injected')})`;
        run(literal);
        assert.equal(existsSync(join(dir, 'injected')), false);
        assert.ok(readFileSync(join(dir, 'body'), 'utf8').includes(literal));
        run('');
        assert.match(readFileSync(join(dir, 'body'), 'utf8'), /failed before it produced a report/);
        run('');
        assert.equal(readFileSync(join(dir, 'writes'), 'utf8'), 'create\nedit\nedit\n');
        rmSync(join(dir, 'body'));
        run('TEST ONLY: delivery exercise', 'true');
        const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
        const lastCreate = calls.filter(args => args[0] === 'issue' && args[1] === 'create').at(-1);
        assert.equal(lastCreate[lastCreate.indexOf('--label') + 1], 'fal-queue-staging-test');
        assert.equal(lastCreate[lastCreate.indexOf('--title') + 1], 'TEST: staging fal queue alert delivery');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('synthetic failure requires a clean live check and leaves genuine failures on the incident path', () => {
    const checkerScript = workflow.split('        run: |\n')[1].split('\n  alert:')[0]
        .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'fal-watch-check-'));
    try {
        writeFileSync(join(dir, 'node'), '#!/bin/bash\necho "Live metrics fixture"\nexit "$CHECK_EXIT"\n', { mode: 0o755 });
        for (const [testAlert, checkExit, expectedExit, testMode] of [
            ['true', '0', 1, 'true'], ['false', '0', 0, 'false'], ['true', '2', 2, 'false'],
        ]) {
            const output = join(dir, 'output');
            writeFileSync(output, '');
            const result = spawnSync('bash', ['-c', checkerScript], {
                encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir,
                    GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, 'summary'),
                    TEST_ALERT: testAlert, CHECK_EXIT: checkExit },
            });
            assert.equal(result.status, expectedExit, result.stderr);
            assert.ok(readFileSync(output, 'utf8').includes(`test_mode=${testMode}`));
            assert.equal(readFileSync(join(dir, 'fal-queue-report.txt'), 'utf8').includes('TEST ONLY:'), testMode === 'true');
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
