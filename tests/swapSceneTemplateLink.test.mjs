import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a blocked template links to its Swap scene only after the public gate answers', () => {
  const recipe = read('app/veyrnox/_components/TemplateRecipe.js');
  assert.match(recipe, /useSwapSceneAvailable\(sourceUnsupported \? preset\.id : null\)/, 'lookup only for source-unsupported templates');
  assert.match(recipe, /swapSceneAvailable && <Link href=\{`\/app\/create\?swap=\$\{encodeURIComponent\(preset\.id\)\}`\}/);
  const hook = read('app/veyrnox/_lib/useSwapSceneAvailable.js');
  assert.match(hook, /\/api\/catalog\?swap=\$\{encodeURIComponent\(id\)\}/);
  assert.match(hook, /if \(typeof id !== 'string' \|\| !id\) return;/, 'no request without an id');
  assert.doesNotMatch(hook, /useSearchParams/, 'public pages do not depend on the query string');
});

test('the link copy exists in all eleven locales', () => {
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    assert.match(read(`lib/i18n/messages/${locale}.mjs`), /"public\.TemplateRecipe\.swapSceneCta": "[^"]+",/, locale);
  }
});
