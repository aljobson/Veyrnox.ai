import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalog } from '../apps/mobile/scripts/sync-web-i18n.mjs';

// ADR-0107: the mobile check reads the web catalogs as data. #2693 added a data-only import to every catalog,
// which made `new Function` fail with "Cannot use import statement outside a module".
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-i18n-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test('a catalog may import data-only helpers and spread them', () => {
  const dir = fixture({
    'copy.mjs': "export const SHARED = Object.freeze({ 'a.one': 'one' });\nconst T = { de: { 'a.two': 'zwei' } };\nexport function current(locale) { return T[locale] || {}; }\n",
    'de.mjs': "// comment\nimport { SHARED, current } from './copy.mjs';\n\nexport default {\n  \"x.y\": \"it's { fine }\",\n  ...SHARED,\n  ...current('de'),\n};\n",
  });
  try {
    assert.deepEqual(readCatalog(join(dir, 'de.mjs')), { 'x.y': "it's { fine }", 'a.one': 'one', 'a.two': 'zwei' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a catalog without imports still reads, and a helper that imports is refused', () => {
  const dir = fixture({
    'plain.mjs': "export default { \"k\": \"v\" };\n",
    'bad.mjs': "import { z } from './deep.mjs';\nexport const A = z;\n",
    'deep.mjs': "export const z = 1;\n",
    'c.mjs': "import { A } from './bad.mjs';\nexport default { ...{ A } };\n",
  });
  try {
    assert.deepEqual(readCatalog(join(dir, 'plain.mjs')), { k: 'v' });
    assert.throws(() => readCatalog(join(dir, 'c.mjs')), /cannot import/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every real web catalog loads through the same reader', () => {
  for (const code of ['en', 'de', 'ja']) {
    const catalog = readCatalog(new URL(`../lib/i18n/messages/${code}.mjs`, import.meta.url).pathname);
    assert.ok(catalog['mcp.lead.current'], `${code} carries the shared Music MCP copy`);
  }
});
