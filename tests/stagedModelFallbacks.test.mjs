import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as tokens from '../app/veyrnox/_lib/tokens.js';
import { MODELS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { fallbackModels } from '../app/veyrnox/_lib/modelPages.js';
import { fromFallback } from '../app/veyrnox/_lib/useCatalog.js';
import { featuredModels } from '../app/veyrnox/_lib/modelSummaries.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { translator } from '../lib/i18n/translate.mjs';
import * as translate from '../lib/i18n/translate.mjs';

test('staged models stay resolvable but never enter public fallback lists', async () => {
  const id = 'kling-o1-reference';
  assert.equal(MODELS.find(model => model.id === id)?.staged, true);
  assert.equal(modelIdForName('Kling O1 · Reference'), id);
  assert.equal(fallbackCapabilitiesFor(id).media.video.minSeconds, 3);

  const search = 'app/veyrnox/_components/SiteSearch.js';
  const pricing = 'app/veyrnox/pricing/page.js';
  const home = 'app/veyrnox/page.js';
  // Execute the actual list builders without loading unrelated page components.
  function load(file, names) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') + `\nexport { ${names.join(', ')} };`;
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    const require = path => path.endsWith('/tokens') ? tokens : path.endsWith('/translate.mjs') ? translate : path.endsWith('/publicCatalog.js')
      ? { readPublicCatalog: async () => { throw new Error('offline'); } } : {};
    new Function('require', 'module', 'exports', code)(require, module, module.exports);
    return module.exports;
  }
  const siteSearch = load(search, ['FALLBACK_MODELS', 'modelsToIndex', 'staticIndex']);
  const expected = MODELS.filter(model => !model.staged).map(model => model.id);
  for (const [name, rows] of Object.entries({
    search: siteSearch.FALLBACK_MODELS,
    pricing: load(pricing, ['FALLBACK_MODELS']).FALLBACK_MODELS,
    home: await load(home, ['loadCatalog']).loadCatalog(),
    modelPages: fallbackModels(),
    create: fromFallback(),
  })) {
    assert.deepEqual(rows.map(model => model.id), expected, name);
    assert.ok(!rows.some(model => model.id === id), name);
  }
  const t = translator('en');
  const index = [...siteSearch.staticIndex(siteSearch.FALLBACK_MODELS, false, t), ...siteSearch.modelsToIndex(MODELS, t)];
  assert.ok(index.some(item => item.group === 'Models'));
  assert.doesNotMatch(JSON.stringify(index), /kling-o1-reference|Kling O1 · Reference/);
  assert.ok(!featuredModels().some(model => model.id === id));
  // Featured ids may change later: even an otherwise featured row must respect staging.
  assert.deepEqual(featuredModels(MODELS.map(model => ({ ...model, staged: true }))), []);
});
