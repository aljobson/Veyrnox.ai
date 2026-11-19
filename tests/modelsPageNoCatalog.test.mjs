// /models lists models and prices; it must not pull the template catalog into its server chunk set.
// Reaching _lib/templates.js (directly or through showcase.js or modelPages.js) loads the 3.6 MiB catalog chunk
// on a cold start for a page that does not show a template (cold-start plan E3a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

function resolveLocal(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.jsx`, `${base}/index.js`]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try { readFileSync(candidate); return candidate; } catch { /* a directory */ }
    }
  }
  return null;
}

function reachable(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      const next = resolveLocal(file, match[1]);
      if (next) stack.push(next);
    }
  }
  return seen;
}

test('/models does not statically reach the template catalog', () => {
  const entry = resolve(root, 'app/veyrnox/models/page.js');
  const files = [...reachable(entry)].map((file) => file.slice(root.length + 1));
  const offenders = files.filter((file) => /(^|\/)(templates|sourceTemplates|sourcePromptRecords)\.js$/.test(file));
  assert.deepEqual(offenders, []);
});

test('the model group constants keep their shape and showcase.js still re-exports them', async () => {
  const groups = await import('../app/veyrnox/_lib/modelGroups.js');
  assert.deepEqual(groups.LIST_GROUPS.map((g) => g.kind), ['video', 'image', 'audio']);
  assert.deepEqual(Object.keys(groups.GROUP_KEYS), ['video', 'image', 'audio']);
  assert.deepEqual(Object.keys(groups.KIND_HUE), ['video', 'image', 'audio']);
  const showcase = readFileSync(resolve(root, 'app/veyrnox/_sections/showcase.js'), 'utf8');
  assert.match(showcase, /export \{ LIST_GROUPS, GROUP_KEYS, KIND_HUE \} from '\.\.\/_lib\/modelGroups\.js'/);
});

test('the home page still reaches the catalog for its wall (guards the walker itself)', () => {
  const entry = resolve(root, 'app/veyrnox/page.js');
  const files = [...reachable(entry)].map((file) => file.slice(root.length + 1));
  assert.ok(files.some((file) => file.endsWith('_lib/templates.js')));
});
