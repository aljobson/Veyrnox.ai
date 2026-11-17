import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const doc = readFileSync('docs/compliance/sub-processors.md', 'utf8');
const inventory = doc.split('## Inventory')[1].split('## Explicit adapter exclusions')[0];
const exclusions = doc.split('## Explicit adapter exclusions')[1].split('## Retention')[0];
test('every executable adapter has an evidenced vendor entry or explicit exclusion', () => {
  for (const file of readdirSync('packages/adapters', { recursive: true }).filter(f => /\.[cm]?js$/.test(f))) {
    const path = `packages/adapters/${file}`;
    assert.ok(inventory.includes('`' + path + '`') || exclusions.includes('`' + path + '`'), path);
  }
  assert.match(inventory, /Crun.*packages\/adapters\/crun\.js/);
  assert.match(inventory, /Higgsfield.*Console opt-out.*packages\/adapters\/higgsfield\.js/);
  assert.match(exclusions, /common\.js.*NON-VENDOR/);
});
test('each register row has existing evidence, with no claim of an executed DPA', () => {
  for (const row of inventory.split('\n').filter(r => r.startsWith('| ') && !r.startsWith('| Name') && !r.startsWith('| ---'))) {
    assert.match(row, /UNKNOWN — owner to confirm/);
    const paths = [...row.matchAll(/`([^`]+)`/g)].map(m => m[1]);
    assert.ok(paths.length, row);
    for (const path of paths) assert.ok(existsSync(path), path);
  }
  for (const [, path] of doc.matchAll(/`([^`]+\.(?:js|mjs|md|sql|jsonc))`/g)) assert.ok(existsSync(path), path);
});

test('age recording is conditional and the policy names no suppliers', async () => {
  const { default: en } = await import('../lib/i18n/messages/legal/en/privacy.mjs');
  assert.match(en.b080, /^Where we ask you to confirm your age,/);
  assert.match(en.b078, /Where we ask for age confirmation,/);
  assert.doesNotMatch(en.b078, /Age confirmation supports contractual eligibility/);
});
