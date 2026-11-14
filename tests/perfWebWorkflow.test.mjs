import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/perf-web.yml', import.meta.url), 'utf8');
const lighthouse = JSON.parse(readFileSync(new URL('../.github/lighthouse/lighthouserc.json', import.meta.url), 'utf8'));

test('the Lighthouse reports are uploaded although their directory is hidden', () => {
  assert.equal(lighthouse.ci.upload.outputDir, '.lighthouseci');
  const upload = workflow.slice(workflow.indexOf('name: Keep the reports'));
  assert.match(upload, /if: always\(\)/);
  assert.match(upload, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(upload, /path: \.lighthouseci\/\n/);
  assert.match(upload, /\n\s+include-hidden-files: true\n/);
});

function summaryScript() {
  const match = workflow.match(/name: Print the median scores\n\s+if: always\(\)\n\s+run: \|\n\s+node - <<'NODE' \| tee -a "\$GITHUB_STEP_SUMMARY"\n([^]*?)\n\s+NODE\n/);
  assert.ok(match, 'the scores are printed to the log and the job summary');
  return match[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
}

test('the median category scores of each page are printed, from the representative runs only', async () => {
  assert.ok(workflow.indexOf('name: Lighthouse') < workflow.indexOf('name: Print the median scores'));
  const directory = await mkdtemp(path.join(tmpdir(), 'veyrnox-perf-web-test-'));
  const run = () => execFileSync(process.execPath, ['-'], { cwd: directory, input: summaryScript(), encoding: 'utf8' });
  try {
    assert.match(run(), /^No Lighthouse manifest was written/, 'a run that produced nothing must not fail this step');
    await mkdir(path.join(directory, '.lighthouseci'));
    await writeFile(path.join(directory, '.lighthouseci/manifest.json'), JSON.stringify([
      { url: 'https://veyrnox.ai/', isRepresentativeRun: false, summary: { performance: 0.1, accessibility: 0.1, 'best-practices': 0.1, seo: 0.1 } },
      { url: 'https://veyrnox.ai/', isRepresentativeRun: true, summary: { performance: 0.674, accessibility: 0.96, 'best-practices': 1, seo: 0.92 } },
      { url: 'https://veyrnox.ai/pricing', isRepresentativeRun: true, summary: { performance: 0.81, accessibility: 1 } },
    ]));
    assert.deepEqual(run().trim().split('\n'), [
      '### Lighthouse median scores',
      '',
      '| Page | performance | accessibility | best-practices | seo |',
      '|---|---:|---:|---:|---:|',
      '| https://veyrnox.ai/ | 67 | 96 | 100 | 92 |',
      '| https://veyrnox.ai/pricing | 81 | 100 | n/a | n/a |',
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
