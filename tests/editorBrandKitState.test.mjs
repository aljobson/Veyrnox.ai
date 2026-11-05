import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { emptyBrandKit } from '../lib/editorShared.js';

async function resourceFixture() {
  const state = [], refs = []; let stateIndex = 0, refIndex = 0, failure;
  globalThis.__editorKitHook = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useCallback: fn => fn, useEffect() {},
    getStoredUserId: () => 'actor', onSessionChange() {}, makeIdempotencyKey: () => 'test-key',
    gatewayFetch: async () => { if (failure) throw failure; return { kit: emptyBrandKit(), version: 1, canEdit: true }; },
  };
  const source = (await readFile(new URL('../app/veyrnox/_components/editor/useEditorResource.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, 'const {$1} = globalThis.__editorKitHook;');
  const { useEditorResource: runResource } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return {
    render() { stateIndex = 0; refIndex = 0; return runResource('/workspaces/workspace/brand-kit'); },
    fail(code) { failure = Object.assign(Error(code), { code, status: 409 }); },
    async settle() { await new Promise(setImmediate); },
    dispose() { delete globalThis.__editorKitHook; },
  };
}

test('editor resource distinguishes version conflicts from account-change 409s on reads and writes', async () => {
  const f = await resourceFixture();
  try {
    f.render().reload(); await f.settle();
    for (const code of ['VERSION_CONFLICT', 'account_changed']) {
      f.fail(code); await f.render().mutate({ expected_version: 1, kit: emptyBrandKit() }, 'PUT');
      let resource = f.render();
      assert.equal(resource.errorCode, code); assert.equal(resource.errorStatus, 409);
      assert.match(resource.error, code === 'VERSION_CONFLICT' ? /newer version/ : /account changed/);
      resource.reload(); await f.settle(); resource = f.render();
      assert.equal(resource.errorCode, code);
      if (code === 'account_changed') assert.doesNotMatch(resource.error, /newer version/);
    }
  } finally { f.dispose(); }
});

test('brand panel renders account-change guidance instead of the version-conflict message', async () => {
  const messages = await appMessagesFor('en');
  for (const data of [null, { kit: emptyBrandKit(), version: 1, canEdit: true }]) {
    const resource = { data, error: 'The account changed. Retry from the current account.', errorCode: 'account_changed', errorStatus: 409 };
    const f = fixture('en', '/app/editor', { messages, moduleMocks: {
      './useEditorResource': { useEditorResource: () => resource },
      './BrandAssetPicker': { BrandAssetPicker: () => null },
    } });
    const { BrandKitPanel } = f.load('app/veyrnox/_components/editor/BrandKitPanel.js');
    const html = f.render(React.createElement(BrandKitPanel, { project: { workspaceId: 'workspace' } }));
    assert.match(html, /The account changed\. Retry from the current account\./);
    assert.doesNotMatch(html, /newer version/);
  }
});

test('logo picker offers known images already in the kit without opening the Browse catalog', async () => {
  const file = 'app/veyrnox/_components/editor/BrandAssetPicker.js';
  const assets = ['image', 'video', 'unknown'].map(assetId => ({ projectId: 'project', assetId, name: assetId, credit: '', usage: '', url: '' }));
  const f = fixture('en', '/app/editor', { messages: await appMessagesFor('en'), states: {
    [file]: [null, false, '', { identity: `workspace:${JSON.stringify(assets.map(({projectId,assetId})=>({projectId,assetId})))}`, types: { 'project:image': 'image/png', 'project:video': 'video/mp4' } }],
  } });
  const { BrandAssetPicker } = f.load(file);
  const html = f.render(React.createElement(BrandAssetPicker, { workspaceId: 'workspace', assets, onLogo() {}, onChange() {} }));
  const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(([markup]) => markup.includes('Use image as logo'))?.[0];
  assert.ok(button); assert.match(button, /type="button"/); assert.match(button, /min-h-11/);
  assert.doesNotMatch(html, /Use (video|unknown) as logo/);
});
