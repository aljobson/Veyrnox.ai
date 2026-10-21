import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const location = new URL('../.github/workflows/authenticated-feature-qa.yml', import.meta.url);
const workflow = existsSync(location) ? readFileSync(location, 'utf8') : '';
const pageQa = readFileSync(new URL('../.github/workflows/page-qa.yml', import.meta.url), 'utf8');
const config = readFileSync(new URL('../e2e/authenticated-fixtures.config.mjs', import.meta.url), 'utf8');
const runtimeStep = () => {
  const match = workflow.match(/      - name: Exercise all isolated authenticated features\n([^]*?)(?=\n      - name:|$)/);
  assert.ok(match, 'full isolated feature suite must have its own step');
  return match[1];
};
const runtimeScript = () => {
  const match = runtimeStep().match(/        run: \|\n([^]*)/);
  assert.ok(match, 'owned server and suite must share a single bounded shell');
  return match[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
};

test('isolated feature QA gates pull requests and main pushes with read-only permissions', () => {
  assert.match(workflow, /on:\n  pull_request:\n  push:\n    branches: \[main\]/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /isolated-feature-qa:\n    runs-on: ubuntu-latest\n    timeout-minutes: 35/);
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|actions: write|id-token: write|continue-on-error/);
});
test('QA uses existing pinned actions, Node22 and recursive public source checkout without persistent credentials', () => {
  for (const action of ['checkout', 'setup-node', 'upload-artifact']) {
    const revision = pageQa.match(new RegExp(`actions/${action}@([a-f0-9]{40})`))?.[1];
    assert.ok(revision);
    assert.ok(workflow.includes(`actions/${action}@${revision}`));
  }
  assert.match(workflow, /submodules: recursive/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node-version: '22'/);
});
test('reproducible install, pinned browser and webpack build precede all feature tests', () => {
  const steps = ['npm ci --no-audit --no-fund', 'npm install --no-save --no-audit --no-fund @playwright/test@1.63.0',
    'npx playwright install --with-deps chromium', 'npm run build -- --webpack', 'name: Exercise all isolated authenticated features'];
  let previous = -1;
  for (const step of steps) { const index = workflow.indexOf(step); assert.ok(index > previous, `ordered required step: ${step}`); previous = index; }
});
test('the fixture lifecycle source and its regression tests pass lint before browser acceptance', () => {
  const lint = 'npx eslint e2e/fixtures/authenticated-product.mjs e2e/authenticated-privacy-choices.spec.mjs tests/authenticatedFixtureSafety.test.mjs tests/authenticatedFeatureQaWorkflow.test.mjs --max-warnings=0';
  assert.ok(workflow.includes(lint), 'test fixture source must have its own lint gate');
  assert.ok(workflow.indexOf(lint) < workflow.indexOf('npm run build -- --webpack'));
});
test('privacy choice acceptance is built with an explicitly synthetic analytics key, never a real provider secret', () => {
  const build = workflow.match(/      - name: Build owned local application\n([^]*?)(?=\n      - name:|$)/)?.[1];
  assert.ok(build, 'the owned build step exists');
  assert.match(build, /        env:\n          NEXT_PUBLIC_POSTHOG_KEY: phc_synthetic_privacy_qa\n/);
  assert.equal((workflow.match(/^\s+NEXT_PUBLIC_POSTHOG_KEY:/gm) || []).length, 1, 'fake browser build key is scoped only to this step');
  assert.doesNotMatch(runtimeStep(), /NEXT_PUBLIC_POSTHOG_KEY|POSTHOG_API_KEY/);
  const privacy = readFileSync(new URL('../e2e/authenticated-privacy-choices.spec.mjs', import.meta.url), 'utf8');
  assert.match(privacy, /from '@playwright\/test'/, 'privacy suite must not inherit the automatic Decline fixture');
  for (const choice of ['Allow analytics & replay', 'Analytics only', 'Decline']) assert.ok(privacy.includes(choice));
  assert.match(privacy, /url\.origin !== target\.origin/);
  assert.match(privacy, /url\.pathname\.startsWith\('\/ingest\/'\)/);
  assert.match(privacy, /route\.fulfill/);
  assert.match(config, /testMatch: 'authenticated-\*\.spec\.mjs'/, 'privacy suite remains part of the unfiltered desktop/mobile matrix');
});
test('all six rollout flags are local to the synthetic runtime step and no real account or provider configuration is supplied', () => {
  const step = runtimeStep();
  for (const flag of ['PUBLISH_ENABLED', 'PUBLISH_CALENDAR_ENABLED', 'TENANT_PROJECTS_ENABLED', 'EDITOR_SHARED_TOOLS_ENABLED', 'EDITOR_TIMELINE_ENABLED', 'EDITOR_MULTITRACK_ENABLED']) {
    assert.match(step, new RegExp(`${flag}: 'true'`));
    assert.equal((workflow.match(new RegExp(`\\b${flag}:`, 'g')) || []).length, 1);
  }
  assert.match(workflow, /QA_FIXTURE_BASE_URL: http:\/\/127\.0\.0\.1:3100/);
  assert.doesNotMatch(workflow, /secrets\.|QA_STORAGE_STATE|E2E_EMAIL|E2E_PASSWORD|API_KEY|BILLING_KEY|MANAGEMENT_KEY|SERVICE_ROLE|\.env|create-qa-state|wrangler|migrat|npm run deploy/);
});
test('the server is an explicitly owned direct Next PID with EXIT cleanup and bounded loopback readiness', () => {
  const script = runtimeScript();
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /node node_modules\/next\/dist\/bin\/next start --hostname 127\.0\.0\.1 --port 3100 .*&/);
  assert.match(script, /QA_SERVER_PID=\$!/);
  assert.match(script, /trap .*kill "\$QA_SERVER_PID".*wait "\$QA_SERVER_PID".* EXIT/);
  assert.match(script, /QA_READY_DEADLINE=\$\(\(SECONDS \+ 60\)\)/);
  assert.match(script, /curl --fail --silent --show-error --max-time 2 http:\/\/127\.0\.0\.1:3100\/app/);
  assert.match(script, /kill -0 "\$QA_SERVER_PID"/);
  assert.match(script, /SECONDS >= QA_READY_DEADLINE/);
  assert.match(script, /sleep 1/);
  assert.doesNotMatch(script, /pkill|killall|kill -9|reuseExistingServer|waitForTimeout/);
  execFileSync('/bin/bash', ['-n'], { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
});
test('the entire unchanged fixture matrix runs once with one worker, no retries and no filtered acceptance', () => {
  const script = runtimeScript();
  assert.match(script, /npx playwright test -c e2e\/authenticated-fixtures\.config\.mjs --workers=1 --retries=0\s*$/);
  assert.doesNotMatch(script, /--grep|--project|--repeat-each|--timeout|--global-timeout|\|\| true.*playwright|playwright.*\|\|/);
  assert.match(config, /testMatch: 'authenticated-\*\.spec\.mjs', timeout: 60_000/);
  assert.match(config, /retries: 0, workers: 1/);
  assert.match(config, /actionTimeout: 10_000, navigationTimeout: 30_000/);
});
test('synthetic reports, retained failure traces and server log survive failed acceptance', () => {
  assert.match(workflow, /QA_FIXTURE_OUTPUT_DIR: \$\{\{ github\.workspace \}\}\/test-results\/authenticated-feature\/browser/);
  assert.match(workflow, /QA_FIXTURE_REPORT: \$\{\{ github\.workspace \}\}\/test-results\/authenticated-feature\/report\.json/);
  assert.match(runtimeScript(), /> test-results\/authenticated-feature\/server\.log 2>&1 &/);
  assert.match(workflow, /name: Retain isolated feature QA evidence\n        if: always\(\)/);
  assert.match(workflow, /path: \$\{\{ github\.workspace \}\}\/test-results\/authenticated-feature\//);
  assert.match(workflow, /retention-days: 7/);
});

test('config-relative Playwright paths cannot move browser traces or JSON outside the upload root', () => {
  const workspace = '/home/runner/work/Veyrnox.ai/Veyrnox.ai';
  const artifact = resolve(workspace, 'test-results/authenticated-feature');
  for (const [key, suffix] of [['QA_FIXTURE_OUTPUT_DIR', 'browser'], ['QA_FIXTURE_REPORT', 'report.json']]) {
    const raw = workflow.match(new RegExp(`^          ${key}: (.+)$`, 'm'))?.[1];
    assert.ok(raw, `${key} must be explicit`);
    const configured = raw.replace('${{ github.workspace }}', workspace);
    assert.ok(isAbsolute(configured), `${key} must not depend on config-directory resolution`);
    for (const base of [workspace, resolve(workspace, 'e2e')]) {
      assert.equal(resolve(base, configured), resolve(artifact, suffix));
    }
  }
  assert.match(config, /outputDir: process\.env\.QA_FIXTURE_OUTPUT_DIR/);
  assert.match(config, /outputFile: process\.env\.QA_FIXTURE_REPORT/);
});
