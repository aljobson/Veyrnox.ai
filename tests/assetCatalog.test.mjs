import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetCatalogLoader } from '../lib/i18n/assetCatalog.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import english from '../lib/i18n/messages/app/en.mjs';
import russian from '../lib/i18n/messages/app/ru.mjs';

test('asset catalogs parse JSON and share pending and completed loads per locale', async () => {
  const urls = [];
  const assets = { async fetch(url) {
    assert.equal(this, assets, 'binding fetch keeps its receiver');
    urls.push(url);
    return new Response(JSON.stringify({ greeting: url.endsWith('/ru.json') ? 'Привет' : 'Hello' }));
  } };
  const load = createAssetCatalogLoader('app', { context: () => ({ env: { ASSETS: assets } }) });
  const first = load('ru');
  assert.equal(first, load('ru'));
  assert.deepEqual(await first, { greeting: 'Привет' });
  assert.equal(await load('ru'), await first);
  assert.deepEqual(await load('unknown'), { greeting: 'Hello' });
  await load('en');
  assert.deepEqual(urls, ['https://assets.local/_i18n/app/ru.json', 'https://assets.local/_i18n/app/en.json']);
});

for (const failure of ['http', 'network', 'json']) {
  test(`asset ${failure} failures surface and are evicted before retry`, async () => {
    let calls = 0;
    const load = createAssetCatalogLoader('app', { context: () => ({ env: { ASSETS: {
      async fetch() {
        if (++calls > 1) return new Response('{"recovered":true}');
        if (failure === 'http') return new Response('missing', { status: 404 });
        if (failure === 'network') throw new Error('offline');
        return new Response('invalid json');
      },
    } } }) });
    await assert.rejects(load('ru'), failure === 'http' ? /assets returned 404/ : failure === 'network' ? /offline/ : SyntaxError);
    assert.deepEqual(await load('ru'), { recovered: true });
    await load('ru');
    assert.equal(calls, 2);
  });
}

test('missing or unavailable context loads the source modules from the project root', async () => {
  for (const context of [() => { throw new Error('not a Worker'); }, () => ({ env: {} })]) {
    const load = createAssetCatalogLoader('app', { context });
    assert.deepEqual(await load('ru'), russian);
    assert.deepEqual(await load('invalid'), english);
  }
  assert.deepEqual(await appMessagesFor('ru'), { ...english, ...russian });
  assert.deepEqual(await appMessagesFor('unknown'), english);
});

test('appMessagesFor keeps English fallback and selected asset overrides without source strings', async () => {
  const key = Symbol.for('__cloudflare-context__');
  const previous = globalThis[key];
  const urls = [];
  globalThis[key] = { env: { ASSETS: { async fetch(url) {
    urls.push(url);
    return new Response(JSON.stringify(url.endsWith('/en.json')
      ? { fallback: 'English only', shared: 'Hello' } : { shared: 'Привет' }));
  } } } };
  try {
    // A fresh module represents a fresh isolate and owns an empty catalog cache.
    const { appMessagesFor: messages } = await import('../lib/i18n/appMessages.mjs?asset-test');
    assert.deepEqual(await messages('ru'), { fallback: 'English only', shared: 'Привет' });
    assert.deepEqual(await messages('invalid'), { fallback: 'English only', shared: 'Hello' });
    await messages('ru');
    assert.equal(urls.length, 2);
  } finally {
    if (previous === undefined) delete globalThis[key];
    else globalThis[key] = previous;
  }
});
