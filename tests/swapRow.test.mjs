import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { TEMPLATE_SWAP_ROW } from '../app/veyrnox/_lib/templateSwapRow.js';
import { TEMPLATE_SWAP_CLIPS } from '../app/veyrnox/_lib/templateSwapClips.js';
import { DUPLICATE_TEMPLATE_KEEPERS } from '../app/veyrnox/_lib/duplicateTemplateIds.js';
import { fetchSwapRow, swapRowRatio } from '../app/veyrnox/_lib/swapRowClient.mjs';
import { templateDetail } from '../lib/clientTemplates.js';
import { loadTemplateSwapRow } from '../lib/templateSwapClipGate.js';
import { catalog, manifest, id as fixtureId, registry as fixtureRegistry } from './fixtures/templateSwapClips.mjs';

test('the curated row: 13 unique ids, no multi-person scenes, all swap clips, none withdrawn, data equals the template data, posters on disk', () => {
  const ids = TEMPLATE_SWAP_ROW.map(row => row.id);
  assert.equal(ids.length, 13); assert.equal(new Set(ids).size, 13);
  for (const out of ['basketball-3', 'community-billboard-product-swap', 'community-stadium-ball-control']) assert.ok(!ids.includes(out), out);
  for (const row of TEMPLATE_SWAP_ROW) {
    assert.ok(TEMPLATE_SWAP_CLIPS.includes(row.id), row.id);
    assert.ok(!Object.hasOwn(DUPLICATE_TEMPLATE_KEEPERS, row.id), row.id);
    const detail = templateDetail(row.id);
    assert.deepEqual({ name: detail.name, poster: detail.clip.poster, aspectRatio: detail.clip.aspectRatio }, { name: row.name, poster: row.poster, aspectRatio: row.aspectRatio }, row.id);
    assert.ok(existsSync(new URL('../public' + row.poster, import.meta.url)), row.poster);
    assert.doesNotMatch(row.name + row.id, /\b(car|truck|vehicle)\b|supercar|duo|trio|dual|duel/i);
  }
});

const answer = (status, body) => async () => ({ status, json: async () => body });
test('fetchSwapRow keeps the row order, uses the server price, and is [] for off, error and nonsense', async () => {
  const a = TEMPLATE_SWAP_ROW[3].id, b = TEMPLATE_SWAP_ROW[1].id;
  const rows = await fetchSwapRow(answer(200, { items: [{ id: a, credits: 47 }, { id: b, credits: 50 }, { id: 'unknown', credits: 47 }, { id: TEMPLATE_SWAP_ROW[2].id, credits: 0 }] }), 'https://x.test');
  assert.deepEqual(rows.map(r => [r.id, r.credits]), [[b, 50], [a, 47]]);
  assert.deepEqual(await fetchSwapRow(answer(200, { items: [] })), []);
  for (const bad of [answer(404, {}), answer(200, null), answer(200, { items: 'x' }), async () => { throw new Error('offline'); }]) assert.deepEqual(await fetchSwapRow(bad), []);
  let url; await fetchSwapRow(async u => { url = u; return { status: 200, json: async () => ({ items: [] }) }; }, 'https://x.test');
  assert.equal(url, 'https://x.test/api/catalog?template_swap_row=1');
  assert.equal(swapRowRatio('406 / 720'), '406 / 720'); assert.equal(swapRowRatio('x; y'), '9 / 16');
});

test('server: switch off reads nothing and answers []; on answers only live ids with the catalog price', async () => {
  const on = { MULTI_REFERENCE_ENABLED: 'true', TEMPLATE_SWAP_CLIP_ENABLED: 'true' };
  let reads = 0;
  const readManifest = async () => { reads++; return manifest; }, read = async () => catalog;
  assert.deepEqual(await loadTemplateSwapRow([fixtureId], {}, { env: {}, registry: fixtureRegistry, readManifest, read }), []);
  assert.equal(reads, 0);
  assert.deepEqual(await loadTemplateSwapRow([fixtureId, 'paused-one'], {}, { env: on, registry: [fixtureId, 'paused-one'], readManifest, read }), [{ id: fixtureId, credits: 47 }]);
  assert.equal(reads, 1, 'one manifest read for the whole row');
  assert.deepEqual(await loadTemplateSwapRow([fixtureId], {}, { env: on, registry: fixtureRegistry, readManifest: async () => null, read }), []);
  assert.deepEqual(await loadTemplateSwapRow([fixtureId], {}, { env: on, registry: fixtureRegistry, readManifest, read: async () => { throw new Error('db'); } }), []);
});

function loadComponent(cards) {
  const file = 'app/veyrnox/_components/SwapRow.js', mod = { exports: {} };
  const out = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mocks = { react: { ...React, useState: () => [cards, () => {}], useEffect: () => {} }, 'react/jsx-runtime': jsx, 'next/link': { default: 'a', __esModule: true },
    '../../../components/I18nProvider.jsx': { useI18n: () => ({ t: (k, v) => `${k}:${v?.credits ?? ''}` }) }, '../_lib/swapRowClient.mjs': { fetchSwapRow: async () => [], swapRowRatio: v => v }, '../_lib/tokens': { presetTitle: x => x } };
  new Function('require', 'module', 'exports', out)(name => { if (name in mocks) return mocks[name]; throw Error('missing mock ' + name); }, mod, mod.exports);
  return mod.exports.SwapRow;
}
test('switch off: the row renders no bytes at all; on: cards link to the composer with poster, name and price', () => {
  assert.equal(renderToStaticMarkup(React.createElement(loadComponent([]))), '');
  const html = renderToStaticMarkup(React.createElement(loadComponent([{ ...TEMPLATE_SWAP_ROW[0], credits: 47 }, { ...TEMPLATE_SWAP_ROW[1], credits: 47 }])));
  assert.match(html, /presets\.swap\.title/);
  assert.ok(html.includes(`href="/app/create?preset=${TEMPLATE_SWAP_ROW[0].id}"`));
  assert.ok(html.includes(`src="${TEMPLATE_SWAP_ROW[0].poster}"`));
  assert.match(html, /presets\.swap\.price:47/);
  assert.equal(html.match(/<li /g).length, 2);
});
