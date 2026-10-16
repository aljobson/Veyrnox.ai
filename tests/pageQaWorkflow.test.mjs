import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/page-qa.yml', import.meta.url), 'utf8');
const stateSetup = readFileSync(new URL('../e2e/create-qa-state.mjs', import.meta.url), 'utf8');

test('anonymous coverage and its artifact are independent of authenticated credentials', () => {
  const anonymousRun = workflow.indexOf('name: Sweep every page on anonymous desktop and mobile');
  const anonymousArtifact = workflow.indexOf('name: page-qa-anonymous');
  const authPrep = workflow.indexOf('name: Prepare authenticated staging session');
  assert.ok(anonymousRun >= 0 && anonymousArtifact > anonymousRun && authPrep > anonymousArtifact);
  const anonymousSteps = workflow.slice(anonymousRun, authPrep);
  assert.doesNotMatch(anonymousSteps, /E2E_EMAIL|E2E_PASSWORD|QA_STORAGE_STATE/);
  assert.match(anonymousSteps, /if: always\(\)/);
  assert.match(anonymousSteps, /page-coverage-report\/anonymous/);
  assert.match(anonymousSteps, /test-results\/page-qa-anonymous/);
});

test('missing authentication fails explicitly without running or overwriting anonymous coverage', () => {
  assert.match(stateSetup, /if \(!HAS_ACCOUNT\) throw new Error\('Page QA requires confirmed staging E2E_EMAIL and E2E_PASSWORD'\)/);
  assert.match(workflow, /id: auth_session/);
  assert.match(workflow, /if: always\(\) && steps\.auth_session\.outcome == 'success'/);
  assert.match(workflow, /--project desktop-authenticated --output test-results\/page-qa-authenticated/);
  assert.match(workflow, /QA_REPORT_DIR: page-coverage-report\/authenticated/);
  assert.match(workflow, /name: page-qa-authenticated/);
  assert.doesNotMatch(workflow, /path:.*\.scratch\/qa-session/);
});
