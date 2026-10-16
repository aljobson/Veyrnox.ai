import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function fixture(mode = '') {
  let user = 'account-a'; const callbacks = []; const events = {}; const store = new Map();
  const storage = { getItem: key => { if (mode === 'read') throw Error('blocked'); return store.get(key) || null; }, setItem: (key, value) => { if (mode === 'write') throw Error('quota'); store.set(key, value); }, removeItem: key => { if (mode === 'remove') throw Error('blocked'); store.delete(key); } };
  globalThis.__brandAuth = { getSession: () => user ? { user: { id: user } } : null, onSessionChange: cb => callbacks.push(cb) };
  globalThis.window = { addEventListener: (name, cb) => { events[name] = cb; } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { if (mode === 'getter') throw Error('blocked'); return storage; } });
  const source = readFileSync(new URL('../app/lib/socialBrandSelection.js', import.meta.url), 'utf8').replace(/import\s*\{[^}]+\}\s*from\s*['"]\.\/authClient.js['"];?/, 'const {getSession,onSessionChange}=globalThis.__brandAuth;');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${Math.random()}`).toString('base64')}`);
  return { ...mod, store, events, change(id) { user = id; for (const cb of callbacks) cb(id ? { user: { id } } : null); }, silentChange(id) { user = id; }, mode(value) { mode = value; } };
}
for (const failure of ['getter', 'read', 'write', 'remove']) test(`brand preference survives ${failure} storage denial without throwing`, async () => {
  const f = await fixture(failure); f.setSelectedSocialBrand('brand-one'); assert.equal(f.getSelectedSocialBrand(), 'brand-one'); f.setSelectedSocialBrand(''); assert.equal(f.getSelectedSocialBrand(), '');
});
test('a failed write or remove cannot revive readable stale selection', async () => {
  const f = await fixture(); f.setSelectedSocialBrand('old'); f.mode('write'); f.setSelectedSocialBrand('new'); assert.equal(f.getSelectedSocialBrand(), 'new'); f.mode('remove'); f.setSelectedSocialBrand(''); assert.equal(f.getSelectedSocialBrand(), '');
});
test('selections never survive logout/relogin or transfer to another account', async () => {
  const f = await fixture('remove'); f.setSelectedSocialBrand('private-a'); f.change(null); f.change('account-a'); assert.equal(f.getSelectedSocialBrand(), ''); f.setSelectedSocialBrand('new-a'); f.change('account-b'); assert.equal(f.getSelectedSocialBrand(), ''); f.change('account-a'); assert.equal(f.getSelectedSocialBrand(), '');
});
test('unbound legacy and mismatched account preferences are ignored', async () => {
  const f = await fixture(); f.store.set(f.SOCIAL_BRAND_KEY, 'legacy'); assert.equal(f.getSelectedSocialBrand(), ''); f.store.set(f.SOCIAL_BRAND_KEY, JSON.stringify({ accountId: 'other', brandId: 'foreign' })); f.change('account-b'); assert.equal(f.getSelectedSocialBrand(), '');
});
test('a snapshot expires on brand change, including change away and back', async () => {
  const f = await fixture(); f.setSelectedSocialBrand('one'); const snapshot = f.getSocialBrandSnapshot(); f.setSelectedSocialBrand('two'); f.setSelectedSocialBrand('one'); assert.throws(() => f.assertSocialBrandSnapshot(snapshot), { code: 'brand_changed' });
});
test('selection subscription notifies synchronous brand changes and removes listener', async () => {
  const f = await fixture(); let calls = 0; const unsubscribe = f.onSocialBrandChange(() => { calls++; }); f.setSelectedSocialBrand('one'); assert.equal(calls, 1); unsubscribe(); f.setSelectedSocialBrand('two'); assert.equal(calls, 1);
});
test('observed session expiry cannot revive a stale same-account preference when removal is denied', async () => {
  const f = await fixture(); f.setSelectedSocialBrand('old'); f.mode('remove'); f.silentChange(null); assert.equal(f.getSelectedSocialBrand(), ''); f.silentChange('account-a'); assert.equal(f.getSelectedSocialBrand(), '');
});
test('account-bound preference hydrates only for its matching account and is stored without credentials', async () => {
  const f = await fixture(); f.store.set(f.SOCIAL_BRAND_KEY, JSON.stringify({ accountId: 'account-a', brandId: 'saved' })); assert.equal(f.getSelectedSocialBrand(), 'saved'); f.setSelectedSocialBrand('new'); assert.deepEqual(JSON.parse(f.store.get(f.SOCIAL_BRAND_KEY)), { accountId: 'account-a', brandId: 'new' });
});
test('same-account cross-tab selection updates while foreign and malformed events are ignored', async () => {
  const f = await fixture(); f.setSelectedSocialBrand('local');
  f.events.storage({ key: f.SOCIAL_BRAND_KEY, newValue: JSON.stringify({ accountId: 'other', brandId: 'foreign' }) }); assert.equal(f.getSelectedSocialBrand(), 'local');
  f.events.storage({ key: f.SOCIAL_BRAND_KEY, newValue: '{broken' }); assert.equal(f.getSelectedSocialBrand(), 'local');
  f.events.storage({ key: f.SOCIAL_BRAND_KEY, newValue: JSON.stringify({ accountId: 'account-a', brandId: 'tab-choice' }) }); assert.equal(f.getSelectedSocialBrand(), 'tab-choice');
  f.events.storage({ key: f.SOCIAL_BRAND_KEY, newValue: null }); assert.equal(f.getSelectedSocialBrand(), '');
});
test('actual selection snapshots block account ABA during gateway token await and stable requests retain their exact header', async () => {
  const f = await fixture(); f.setSelectedSocialBrand('brand-a'); const original = f.getSocialBrandSnapshot();
  let resolveToken; const pendingToken = new Promise(resolve => { resolveToken = resolve; }); let requests = 0; let sentBrand;
  globalThis.__snapshotIntegration = { selection: f, auth: { getFreshAccessToken: () => pendingToken, getSession: () => ({ access_token: 'SYNTHETIC-NONSECRET', user: { id: 'account-a' } }), clearSession() {} } };
  const code = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8').replace(/import\s*\{[^}]+\}\s*from\s*['"][^'"]+['"];?/g, statement => statement.includes('authClient') ? 'const {getFreshAccessToken,getSession,clearSession}=globalThis.__snapshotIntegration.auth;' : statement.includes('socialBrandSelection') ? 'const {getSelectedSocialBrand,setSelectedSocialBrand,assertSocialBrandSnapshot}=globalThis.__snapshotIntegration.selection;' : statement.includes('analyticsClient') ? 'const captureOperationalError=()=>{};' : statement.includes('analyticsPrivacy') ? 'const normaliseGatewayPath=value=>value;' : 'const apiErrorDetails=()=>({});');
  const { gatewayFetch } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  globalThis.fetch = async (_url, init) => { requests++; sentBrand = init.headers['x-publish-brand-id']; return Response.json({ ok: true }); };
  const obsolete = gatewayFetch('/social/smartlink', { method: 'PUT', body: '{}' }, false, original);
  f.change('account-b'); f.change('account-a'); f.setSelectedSocialBrand('brand-a'); resolveToken('SYNTHETIC-NONSECRET');
  await assert.rejects(obsolete, { code: 'brand_changed' }); assert.equal(requests, 0);
  assert.deepEqual(await gatewayFetch('/social/smartlink', { method: 'PUT', body: '{}' }, false, f.getSocialBrandSnapshot()), { ok: true }); assert.equal(requests, 1); assert.equal(sentBrand, 'brand-a');
});
