import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/zap-baseline.yml', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../.zap/rules.tsv', import.meta.url), 'utf8');
const rows = rules.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split('\t'));

test('the rules file is valid ZAP baseline configuration with a reason on every line', () => {
  assert.ok(rules.endsWith('\n'));
  for (const row of rows) {
    assert.equal(row.length, 3, row.join(' '));
    assert.match(row[0], /^\d+$/);
    assert.match(row[1], /^(IGNORE|WARN|FAIL)$/);
    assert.ok(row[2].trim().length > 20, `rule ${row[0]} states why`);
  }
  assert.equal(new Set(rows.map(([id]) => id)).size, rows.length, 'one line per rule');
});

test('only the four assessed false positives are ignored; the style-src finding stays a warning', () => {
  const ignored = rows.filter(([, level]) => level === 'IGNORE').map(([id]) => id).sort();
  assert.deepEqual(ignored, ['10015', '10031', '10098', '10099']);
  assert.deepEqual(rows.filter(([id]) => id === '10055').map(([, level]) => level), ['WARN']);
  assert.match(rows.find(([id]) => id === '10099')[2], /translation catalogue/);
  assert.match(rows.find(([id]) => id === '10031')[2], /flight payload/);
  assert.match(rows.find(([id]) => id === '10015')[2], /no-store/);
  assert.match(rows.find(([id]) => id === '10098')[2], /\/api\/developer\/openapi/);
});

test('the scan checks the repository out first and passes the rules file from the mounted directory', () => {
  const checkout = workflow.indexOf('uses: actions/checkout@');
  const scan = workflow.indexOf('name: Scan');
  assert.ok(checkout >= 0 && checkout < scan, 'without a checkout the rules file does not exist');
  assert.match(workflow, /uses: actions\/checkout@[a-f0-9]{40}/);
  const copy = workflow.indexOf('cp .zap/rules.tsv zap-wrk/rules.tsv');
  const run = workflow.indexOf('docker run');
  assert.ok(copy > scan && copy < run);
  assert.match(workflow, /-v "\$PWD\/zap-wrk:\/zap\/wrk:rw"/);
  assert.match(workflow, /zap-baseline\.py -t "\$TARGET" -m 2 -I -c rules\.tsv \\/);
  assert.match(workflow, /\[ "\$code" -le 2 \] && \[ "\$code" -ne 1 \]/, 'a FAIL-level finding still fails the run');
  assert.match(workflow, /TARGET: https:\/\/veyrnox-ai-staging\.al-jobson\.workers\.dev/);
  assert.doesNotMatch(workflow, /veyrnox\.ai\b(?!-)/, 'staging only');
});
