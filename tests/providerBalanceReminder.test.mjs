import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Runs the report job's own `run:` block against a fake `gh`, so the reminder rule is tested as written.
const workflow = readFileSync(new URL('../.github/workflows/provider-balances.yml', import.meta.url), 'utf8');
const stepStart = workflow.indexOf('- name: Open one issue per episode');
const script = workflow.slice(workflow.indexOf('run: |\n', stepStart) + 'run: |\n'.length)
  .split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');

const HOUR = 3600 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function run({ open = '2237', createdAgo, commentsAgo = [], exit = '1' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'balance-reminder-'));
  const log = path.join(dir, 'gh.log');
  const fake = path.join(dir, 'gh');
  const comments = commentsAgo.map((ms) => ({ createdAt: ago(ms) }));
  const view = { createdAt: ago(createdAgo ?? 0), comments };
  writeFileSync(fake, `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "issue list") echo "${open}" ;;
  "issue view")
    case "$*" in
      *comments*) node -e 'const v=JSON.parse(process.env.VIEW);console.log([...v.comments.map(c=>c.createdAt),v.createdAt].sort().pop())' ;;
      *) node -e 'console.log(JSON.parse(process.env.VIEW).createdAt)' ;;
    esac ;;
  "issue comment") cat "$5" >> "${log}.body" ;;
esac
`);
  chmodSync(fake, 0o755);
  writeFileSync(log, '');
  const result = spawnSync('bash', ['-c', script], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, VIEW: JSON.stringify(view), EXIT: exit, REPORT: 'provider balances\n  LOW        fal        at or under floor 20 USD' },
  });
  const calls = readFileSync(log, 'utf8');
  let body = '';
  try { body = readFileSync(`${log}.body`, 'utf8'); } catch { /* no comment made */ }
  return { ...result, calls, body };
}

test('a fresh issue is left alone and nothing is filed twice', () => {
  const r = run({ createdAgo: 3 * HOUR });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /issue comment|issue create/);
  assert.match(r.stdout, /Already tracked in #2237/);
});

test('an issue open for days with no comment gets a reminder naming the days and the state', () => {
  const r = run({ createdAgo: 5 * 24 * HOUR + HOUR });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /issue comment 2237/);
  assert.doesNotMatch(r.calls, /issue create/);
  assert.match(r.body, /open for 5 day\(s\)/);
  assert.match(r.body, /still at or under its floor/);
  assert.match(r.body, /at or under floor 20 USD/, 'the report passes through unchanged: it names the floor, never the balance');
});

test('a comment from the last day keeps it quiet, one older than a day does not', () => {
  assert.doesNotMatch(run({ createdAgo: 6 * 24 * HOUR, commentsAgo: [2 * HOUR] }).calls, /issue comment/);
  assert.match(run({ createdAgo: 6 * 24 * HOUR, commentsAgo: [30 * HOUR, 54 * HOUR] }).calls, /issue comment 2237/);
});

test('an unreadable balance is reminded as unreadable', () => {
  const r = run({ createdAgo: 2 * 24 * HOUR, exit: '2' });
  assert.match(r.body, /still unreadable/);
  assert.match(r.body, /open for 2 day\(s\)/);
});

test('with no open issue the first notice is still an issue, as before', () => {
  const r = run({ open: '', createdAgo: 0 });
  assert.match(r.calls, /issue create/);
  assert.doesNotMatch(r.calls, /issue comment/);
});
