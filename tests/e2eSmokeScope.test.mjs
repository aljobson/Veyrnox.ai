import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const directory = new URL('../e2e/', import.meta.url);
const read = (name) => readFileSync(new URL(name, directory), 'utf8');
const specs = readdirSync(directory).filter(name => name.endsWith('.spec.mjs')).sort();
const configs = readdirSync(directory).filter(name => name.endsWith('.config.mjs') && name !== 'playwright.config.mjs');

function smokeConfig() {
  const source = read('playwright.config.mjs').replace(/^import .*$/gm, '').replace('export default ', 'const result = ');
  return runInNewContext(`${source}\nresult`, {
    process: { env: {} }, BASE_URL: 'https://staging.invalid', devices: { 'Desktop Chrome': {} }, defineConfig: value => value,
  });
}

test('the staging smoke runs only its own specs', () => {
  const config = smokeConfig();
  assert.deepEqual([...config.testMatch].sort(), ['buy.spec.mjs', 'generate.spec.mjs', 'model-switch.spec.mjs', 'signup.spec.mjs']);
  for (const name of config.testMatch) assert.ok(specs.includes(name), `${name} exists`);
  assert.equal(config.testIgnore, 'authenticated-*.spec.mjs');
  assert.doesNotMatch(read('playwright.config.mjs'), /testMatch:\s*'\*/, 'a glob pulls in specs that have their own config');
});

test('a spec with its own config never runs in the smoke, and no spec is left unclaimed', () => {
  const smoke = new Set(smokeConfig().testMatch);
  const owned = configs.flatMap(name => [...read(name).matchAll(/testMatch:\s*'([^']+\.spec\.mjs)'/g)].map(([, pattern]) => pattern));
  assert.ok(['page-coverage.spec.mjs', 'music-preview.spec.mjs', 'music-server.spec.mjs', 'authenticated-*.spec.mjs'].every(pattern => owned.includes(pattern)));
  // A config glob as a regular expression: escape every special character (backslash included), then let * match anything.
  const globToRegExp = (pattern) => new RegExp(`^${pattern.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
  const ownedBy = (name) => owned.some(pattern => globToRegExp(pattern).test(name));
  for (const name of specs) {
    assert.notEqual(smoke.has(name), ownedBy(name), `${name} must run from exactly one config`);
  }
});

test('the README names what the smoke runs', () => {
  const readme = read('README.md');
  for (const name of smokeConfig().testMatch) assert.ok(readme.includes(`\`${name}\``), name);
  for (const name of configs.filter(name => /testMatch:\s*'[^']+\.spec\.mjs'/.test(read(name)))) assert.ok(readme.includes(`\`${name}\``), name);
});
