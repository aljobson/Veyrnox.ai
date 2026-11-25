import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dialogue derives availability and price from the live catalog', () => {
  const source = read('app/veyrnox/app/dialogue/DialogueStudioClient.js');
  assert.match(source, /const available = mode\.status === 'available' && Boolean\(modeModel\)/);
  assert.match(source, /'UNAVAILABLE'/);
  assert.match(source, /model \? `−\$\{model\.credits\} cr` : 'Unavailable'/);
  assert.doesNotMatch(source, /model\?\.credits \?\? 0/);
});

test('Lip Sync defaults to a catalog-backed path and never presents a zero-credit job', () => {
  const source = read('app/veyrnox/app/performance/PerformanceStudioClient.js');
  assert.match(source, /setWorkflowId\('talking-photo'\)/);
  assert.match(source, /availablePerformanceModels\(models, contract\.workflowId\)/);
  assert.match(source, /!available \? 'Unavailable'/);
  assert.match(source, /quoteAvailable \? `−\$\{quote\.totalCredits\} cr` : 'Unavailable'/);
  assert.match(source, /!quoteAvailable \? 'Model unavailable'/);
  assert.doesNotMatch(source, />−\{quote\.totalCredits\} cr</);
});
