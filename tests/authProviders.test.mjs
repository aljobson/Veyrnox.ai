import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configuredProviders, withLiveSettings } from '../app/lib/authProviders.js';
import { AI_ENVIRONMENTS, oauthProvidersFor } from '../packages/security/environments.js';
import { providerDrift } from '../scripts/check-auth-providers.mjs';

test('production offers Apple and Google; local development offers none', () => {
    assert.deepEqual(oauthProvidersFor('production'), ['apple', 'google']);
    assert.deepEqual(oauthProvidersFor('development'), []);
    assert.deepEqual(configuredProviders(oauthProvidersFor('production').join(',')), { apple: true, google: true });
    assert.deepEqual(configuredProviders(''), { apple: false, google: false });
    assert.deepEqual(configuredProviders(' google ,unknown'), { apple: false, google: true });
});

test('a failed settings read leaves the configured buttons in place', () => {
    const configured = { apple: true, google: true };
    assert.deepEqual(withLiveSettings(configured, null), configured);
    assert.deepEqual(withLiveSettings(configured, undefined), configured);
});

test('the live setting can only hide a provider, never add one', () => {
    const configured = { apple: true, google: true };
    assert.deepEqual(withLiveSettings(configured, { external: { apple: false, google: true } }), { apple: false, google: true });
    assert.deepEqual(withLiveSettings({ apple: false, google: true }, { external: { apple: true, google: true } }), { apple: false, google: true });
    assert.deepEqual(withLiveSettings(configured, {}), { apple: false, google: false });
});

test('the drift check names a provider switched off, and one the app does not offer', () => {
    assert.deepEqual(providerDrift(['apple', 'google'], { external: { apple: true, google: true, email: true } }), { missing: [], unlisted: [] });
    assert.deepEqual(providerDrift(['apple', 'google'], { external: { google: true } }), { missing: ['apple'], unlisted: [] });
    assert.deepEqual(providerDrift(['google'], { external: { apple: true, google: true } }), { missing: [], unlisted: ['apple'] });
    assert.deepEqual(providerDrift(['apple'], null), { missing: ['apple'], unlisted: [] });
});

test('the sign-in dialog starts from the build list and only narrows it', () => {
    const gate = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');
    assert.match(gate, /useState\(\(\) => configuredProviders\(process\.env\.NEXT_PUBLIC_AUTH_PROVIDERS\)\)/);
    assert.match(gate, /setOauth\(\(configured\) => withLiveSettings\(configured, data\)\)/);
    const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
    assert.match(config, /NEXT_PUBLIC_AUTH_PROVIDERS: oauthProvidersFor\(identityConfig\.appEnv\)\.join\(','\)/);
    assert.ok(Object.isFrozen(AI_ENVIRONMENTS.production.oauthProviders));
});
