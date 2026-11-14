import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/recovery-health.yml', import.meta.url), 'utf8');

test('recovery alert exercise is opt-in, clean-gated, and separately labelled', () => {
  const alertCondition = workflow.match(/  alert:\n[\s\S]*?    if: >-\n([\s\S]*?)    runs-on:/)?.[1] ?? '';
  assert.match(workflow, /test_alert:/);
  assert.match(workflow, /TEST_ALERT: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.test_alert && 'true' \|\| 'false' \}\}/);
  assert.match(workflow, /\[ "\$code" -eq 0 \] && \[ "\$TEST_ALERT" = 'true' \]/);
  assert.match(workflow, /no production task, queue, payment, or database state changed/);
  assert.match(workflow, /label=recovery-health-test/);
  assert.match(workflow, /title='TEST: recovery-health alert delivery'/);
  assert.match(alertCondition, /github\.ref == 'refs\/heads\/main'/);
  assert.match(alertCondition, /needs\.check\.outputs\.exit == '1'/);
  assert.match(alertCondition, /needs\.check\.outputs\.exit == '2'/);
  assert.match(alertCondition, /needs\.check\.outputs\.test_mode == 'true'/);
  assert.match(workflow, /group: \$\{\{ needs\.check\.outputs\.test_mode == 'true' && 'recovery-health-alert-test' \|\| format\('recovery-health-alert-real-\{0\}', github\.run_id\) \}\}/);
});

test('synthetic alert is produced only after a clean live check', () => {
  const checkerScript = workflow.split('        run: |\n')[1].split('\n  alert:')[0]
    .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'recovery-watch-check-'));
  try {
    writeFileSync(join(dir, 'node'), '#!/bin/bash\necho "Recovery tasks and queues are healthy."\nexit "$CHECK_EXIT"\n', { mode: 0o755 });
    for (const [testAlert, checkExit, expectedExit, testMode] of [
      ['true', '0', 0, 'true'],
      ['false', '0', 0, 'false'],
      ['true', '1', 1, 'false'],
      ['true', '2', 2, 'false'],
    ]) {
      const output = join(dir, 'output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-c', checkerScript], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
          TEST_ALERT: testAlert,
          CHECK_EXIT: checkExit,
        },
      });
      assert.equal(result.status, expectedExit, result.stderr);
      const outputs = readFileSync(output, 'utf8');
      assert.ok(outputs.includes(`test_mode=${testMode}`));
      assert.equal(readFileSync(join(dir, 'report.txt'), 'utf8').includes('TEST ONLY:'), testMode === 'true');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('alert routing preserves real incidents and proves each test delivery', () => {
  const alertScript = workflow.split('        run: |\n')[2]
    .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'recovery-watch-alert-'));
  try {
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.GH_MOCK_DIR, 'calls'), JSON.stringify(args) + '\\n');
if (args[0] === 'label') process.exit(Number(process.env.LABEL_EXIT || 0));
if (args[0] === 'issue' && args[1] === 'list') {
  process.stdout.write(process.env.EXISTING_ISSUE || '');
  process.exit(Number(process.env.LIST_EXIT || 0));
}
if (args[0] === 'issue' && args[1] === 'create') process.exit(Number(process.env.CREATE_EXIT || 0));
process.exit(99);
`, { mode: 0o755 });
    const run = ({ testMode, labelExit = '0', listExit = '0', createExit = '0', existingIssue = '' }) => {
      writeFileSync(join(dir, 'calls'), '');
      const result = spawnSync('bash', ['-c', alertScript], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GH_MOCK_DIR: dir,
          RUNNER_TEMP: dir,
          GH_TOKEN: 'test-only',
          GH_REPO: 'test/fixture',
          REPORT: 'fixed counts-only report',
          RUN_URL: 'https://example.test/run',
          TEST_MODE: testMode,
          LABEL_EXIT: labelExit,
          LIST_EXIT: listExit,
          CREATE_EXIT: createExit,
          EXISTING_ISSUE: existingIssue,
        },
      });
      const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      return { result, calls };
    };

    const real = run({ testMode: 'false', labelExit: '1' });
    assert.equal(real.result.status, 0, real.result.stderr);
    const realCreate = real.calls.find(args => args[0] === 'issue' && args[1] === 'create');
    assert.equal(realCreate[realCreate.indexOf('--label') + 1], 'recovery-health');
    assert.equal(realCreate[realCreate.indexOf('--title') + 1], 'Recovery health needs attention');

    const exercise = run({ testMode: 'true' });
    assert.equal(exercise.result.status, 0, exercise.result.stderr);
    const testCreate = exercise.calls.find(args => args[0] === 'issue' && args[1] === 'create');
    assert.equal(testCreate[testCreate.indexOf('--label') + 1], 'recovery-health-test');
    assert.equal(testCreate[testCreate.indexOf('--title') + 1], 'TEST: recovery-health alert delivery');
    const body = readFileSync(join(dir, 'body.md'), 'utf8');
    assert.match(body, /fixed counts-only report/);
    assert.match(body, /Diagnostic run: https:\/\/example\.test\/run/);

    const existingReal = run({ testMode: 'false', existingIssue: '7\n' });
    assert.equal(existingReal.result.status, 0, existingReal.result.stderr);
    assert.equal(existingReal.calls.some(args => args[0] === 'issue' && args[1] === 'create'), false);

    const realLookupFailure = run({ testMode: 'false', listExit: '1' });
    assert.equal(realLookupFailure.result.status, 0, realLookupFailure.result.stderr);
    assert.equal(realLookupFailure.calls.some(args => args[0] === 'issue' && args[1] === 'create'), true);

    const testLookupFailure = run({ testMode: 'true', listExit: '1' });
    assert.equal(testLookupFailure.result.status, 1);
    assert.equal(testLookupFailure.calls.some(args => args[0] === 'issue' && args[1] === 'create'), false);

    const createFailure = run({ testMode: 'false', createExit: '1' });
    assert.equal(createFailure.result.status, 1);

    const duplicate = run({ testMode: 'true', existingIssue: '42\n' });
    assert.equal(duplicate.result.status, 1);
    assert.match(duplicate.result.stderr, /#42/);
    assert.equal(duplicate.calls.some(args => args[0] === 'issue' && args[1] === 'create'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
