import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Drive the real hook through deterministic renders and deferred transport calls.
// No timers, browser session or live service is needed to exercise stale responses.
async function fixture() {
  let revision = 1, brandId = 'a', state, effect, dependencies, cleanup;
  const calls = [];
  const harness = {
    useState: () => [state, value => { state = value; }],
    useSyncExternalStore: (_subscribe, get) => get(),
    useEffect: (next, deps) => {
      if (!dependencies || deps.some((v, i) => !Object.is(v, dependencies[i]))) {
        cleanup?.(); dependencies = deps; effect = next;
      }
    },
    getSocialBrandRevision: () => revision,
    getSocialBrandSnapshot: () => ({ revision, brandId, accountId: 'account' }),
    assertSocialBrandSnapshot: snapshot => { if (snapshot?.revision !== revision) throw Error('stale'); },
    onSocialBrandChange: () => () => {},
    gatewayFetch: (path, _init, _retry, snapshot) => new Promise((resolve, reject) => calls.push({ path, snapshot, resolve, reject })),
  };
  globalThis.__brandKitHook = harness;
  const source = (await readFile(new URL('../app/veyrnox/app/publish/usePublishBrandKit.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, 'const {$1} = globalThis.__brandKitHook;');
  const hookModule = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${Math.random()}`).toString('base64')}`);
  return {
    calls,
    render(workspaces = false) { return hookModule.usePublishBrandKit(workspaces); },
    async effects() { if (effect) { cleanup = effect(); effect = null; } await new Promise(setImmediate); },
    async settle() { await new Promise(setImmediate); },
    switchBrand(next) { brandId = next; revision++; },
    dispose() { cleanup?.(); delete globalThis.__brandKitHook; },
  };
}
test('kit state clears synchronously on brand change and drops out-of-order reads', async () => {
  const f = await fixture();
  try {
    assert.equal(f.render().status, 'loading'); await f.effects();
    f.switchBrand('b'); assert.equal(f.render().data, undefined); await f.effects();
    assert.deepEqual(f.calls.map(c => c.snapshot.brandId), ['a', 'b']);
    f.calls[1].resolve({ linked: true, kit: { name: 'B' } }); await f.settle();
    assert.equal(f.render().data.kit.name, 'B');
    f.calls[0].resolve({ linked: true, kit: { name: 'A' } }); await f.settle();
    assert.equal(f.render().data.kit.name, 'B');
    f.switchBrand('a'); assert.equal(f.render().data, undefined);
  } finally { f.dispose(); }
});
test('workspace reads use the captured snapshot and old errors cannot replace current state', async () => {
  const f = await fixture();
  try {
    f.render(true); await f.effects();
    f.calls[0].resolve({ linked: false, canLink: true }); await f.settle();
    assert.equal(f.calls[1].path, '/workspaces');
    assert.equal(f.calls[1].snapshot, f.calls[0].snapshot);
    f.switchBrand('b'); f.render(true); await f.effects();
    f.calls[2].resolve({ linked: false, canLink: false }); await f.settle();
    f.calls[1].reject(Object.assign(Error('old workspace failure'), { status: 502 })); await f.settle();
    assert.equal(f.render(true).status, 'ready');
    assert.equal(f.render(true).snapshot.brandId, 'b');
  } finally { f.dispose(); }
});
test('link refresh hides the previous kit and gate-off responses hide the card', async () => {
  const f = await fixture();
  try {
    f.render(); await f.effects(); f.calls[0].resolve({ linked: true, kit: { name: 'Old' } }); await f.settle();
    f.render().reload(); assert.equal(f.render().data, undefined); await f.effects();
    f.calls[1].reject(Object.assign(Error('disabled'), { status: 404 })); await f.settle();
    assert.equal(f.render().status, 'hidden');
  } finally { f.dispose(); }
});

test('hashtag action disables unchanged captions and flags only selected platform variants', async () => {
  const { brandHashtagAction } = await import('../lib/social/brandHashtags.js');
  const variants = { instagram: 'Custom #Brand', bluesky: '' };
  assert.deepEqual(brandHashtagAction('Main #Brand', ['brand'], ['instagram'], variants), {
    caption: 'Main #Brand', disabled: true, hasVariants: true,
  });
  assert.deepEqual(brandHashtagAction('Main', ['brand'], ['instagram'], variants), {
    caption: 'Main #brand', disabled: false, hasVariants: true,
  });
  assert.deepEqual(variants, { instagram: 'Custom #Brand', bluesky: '' });
  assert.equal(brandHashtagAction('Main', ['brand'], ['bluesky'], variants).hasVariants, false);
  assert.equal(brandHashtagAction('Main', [], [], variants).disabled, true);
});

test('brand card shows workspace attribution only for owners and handles empty member kits', async () => {
  const { fixture: renderFixture } = await import('./helpers/publicSiteRender.mjs');
  const { appMessagesFor } = await import('../lib/i18n/appMessages.mjs');
  const { createElement } = await import('react');
  const kit = { name: 'Brand presentation', palette: [], fonts: [], textStyles: [], credits: [] };
  const messages = await appMessagesFor('en');
  for (const [data, expected, forbidden] of [
    [{ linked: true, canLink: false, kit }, /Brand presentation/, /From workspace|undefined/],
    [{ linked: true, canLink: false, empty: true }, /No saved brand kit is available yet/, /From workspace|undefined|\{workspace\}/],
    [{ linked: true, canLink: true, kit, workspaceName: 'Private workspace' }, /From workspace Private workspace/, /undefined/],
  ]) {
    const f = renderFixture('en', '/app/publish', { messages, moduleMocks: {
      './usePublishBrandKit.js': { useSocialBrandRevision: () => 1, usePublishBrandKit: () => ({ status: 'ready', data }) },
    } });
    const Card = f.load('app/veyrnox/app/publish/BrandKitCard.jsx').default;
    const html = f.render(createElement(Card));
    assert.match(html, expected); assert.doesNotMatch(html, forbidden);
  }
});
