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

test('public provider entries have purposes and match the evidenced register in every locale', async () => {
  const { LOCALES } = await import('../lib/i18n/locales.mjs');
  const { legalDocument } = await import('../lib/i18n/legal/catalogs.mjs');
  const names = inventory.split('\n').filter(row => row.startsWith('| ') && !row.startsWith('| Name') && !row.startsWith('| ---'))
    .map(row => row.split('|')[1].trim());
  const canonical = name => name === 'Google (YouTube, Google Business Profile)' ? 'Google' : name;
  for (const { code } of LOCALES) {
    const { messages, blocks } = await legalDocument(code, 'privacy');
    const entries = ['b076', 'b082'].flatMap(key => messages[key].split('; ').filter(part => part.includes(' — ')));
    const listed = entries.map(entry => {
      const [name, purpose] = entry.split(' — ');
      assert.ok(purpose?.trim(), `${code}/${name}: purpose`);
      assert.ok(names.includes(canonical(name)), `${code}/${name}: absent from register`);
      return canonical(name);
    });
    assert.deepEqual([...new Set(listed)].sort(), [...names].sort(), code);
    assert.ok(blocks.find(block => block.key === 'b081' && block.tag === 'h3'), 'social recipients have a separate heading');
    assert.ok(!messages.b076.includes('Meta ('), 'connected networks are not in the service-provider paragraph');
  }
});

test('age recording is conditional and only undecided retention categories are being finalised', async () => {
  const { default: en } = await import('../lib/i18n/messages/legal/en/privacy.mjs');
  assert.match(en.b080, /^Where we ask you to confirm your age,/);
  assert.match(en.b078, /Where we ask for age confirmation,/);
  assert.doesNotMatch(en.b078, /Age confirmation supports contractual eligibility/);
  assert.doesNotMatch(en.b052 + en.b053, /finalis/);
  assert.equal(en.b079, 'Retention periods for store customer records, referral rewards, security events and push records are being finalised.');
  assert.match(en.b076, /BytePlus — planned video generation/);
  assert.match(en.b076, /Crun — generation/);
});
