import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Include imports, re-exports and literal dynamic imports / requires.
const imports = (source) => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);

test('catalog fallback stays a runtime import in webpack and Turbopack', () => {
  assert.match(read('lib/i18n/assetCatalog.mjs'), /import\(\s*\/\*\s*webpackIgnore:\s*true\s*\*\/\s*\/\*\s*turbopackIgnore:\s*true\s*\*\/\s*source\s*\)/);
});

test('Worker lists models without importing page catalogs directly', () => {
  const paths = imports(read('worker.js'));
  assert.ok(paths.includes('./app/veyrnox/_lib/modelList.js'));
  for (const path of paths) assert.doesNotMatch(path, /(?:^|\/)(?:modelPages\.js|templates\.js|translate\.mjs)$/);
});

test('modelList imports only the public catalog and slim tokens', () => {
  assert.deepEqual(imports(read('app/veyrnox/_lib/modelList.js')).sort(), [
    '../../../lib/publicCatalog.js', './tokens.js',
  ].sort());
});
