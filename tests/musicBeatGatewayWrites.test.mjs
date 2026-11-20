import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { configureBeatWrites, capabilityGeneration, assertBeatGeneration } from '../app/veyrnox/_lib/music/beat/beatWriteVersion.mjs';
let fresh = async () => 'token';
globalThis.beatGatewayFixture = {
  getFreshAccessToken: () => fresh(), getSession: () => ({ access_token: 'token', user: { id: 'owner' } }), clearSession() {},
  waitForStepUp: async () => {}, getSelectedSocialBrand: () => null, setSelectedSocialBrand() {}, assertSocialBrandSnapshot() {},
  captureOperationalError() {}, normaliseGatewayPath: p => p,
};
const exportsByFile = {
  '/authClient.js': ['getFreshAccessToken', 'getSession', 'clearSession'],
  '/mfaStepUpWait.js': ['waitForStepUp'],
  '/socialBrandSelection.js': ['getSelectedSocialBrand', 'setSelectedSocialBrand', 'assertSocialBrandSnapshot'],
  '/analyticsClient.js': ['captureOperationalError'], '/analyticsPrivacy.js': ['normaliseGatewayPath'],
};
const hooks = registerHooks({ load(url, context, next) {
  for (const [suffix, names] of Object.entries(exportsByFile)) if (url.endsWith(suffix))
    return { format: 'module', shortCircuit: true, source: `export const { ${names.join(', ')} } = globalThis.beatGatewayFixture;` };
  return next(url, context);
} });
const { gatewayFetch } = await import('../app/veyrnox/_lib/gateway.js'); hooks.deregister();
test.after(() => { delete globalThis.beatGatewayFixture; configureBeatWrites(false); });
test('gateway preserves both server refusal codes exactly', async t => {
  for (const code of ['BEAT_CLIENT_OUTDATED', 'BEAT_WRITES_DISABLED']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'Refused' } }, { status: 409 }));
    await assert.rejects(gatewayFetch('/music/beat-projects/beat', { method: 'PUT' }), { status: 409, code });
    t.mock.restoreAll();
  }
});
test('a capability change during token refresh refuses immediately before network persistence', async t => {
  configureBeatWrites(true); const generation = capabilityGeneration();
  fresh = async () => { configureBeatWrites(false); return 'token'; };
  t.mock.method(globalThis, 'fetch', async () => assert.fail('stale send must not reach fetch'));
  await assert.rejects(gatewayFetch('/music/beat-projects/beat', { method: 'PUT', beforeSend: () => assertBeatGeneration(generation) }), { code: 'capability_changed' });
  fresh = async () => 'token';
});
