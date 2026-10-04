import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configuredProviders, readAuthSettings, providerAvailable, passkeyUnavailableReason } from '../app/lib/authProviders.js';
import { AI_ENVIRONMENTS, oauthProvidersFor } from '../packages/security/environments.js';
import { providerDrift, daysUntil, main } from '../scripts/check-auth-providers.mjs';

test('production offers Apple and Google; local development offers none', () => {
    assert.deepEqual(oauthProvidersFor('production'), ['apple', 'google']);
    assert.deepEqual(oauthProvidersFor('development'), []);
    assert.deepEqual(configuredProviders(oauthProvidersFor('production').join(',')), { apple: true, google: true });
    assert.deepEqual(configuredProviders(''), { apple: false, google: false });
    assert.deepEqual(configuredProviders(' google ,unknown'), { apple: false, google: true });
});

test('both deployed environments expect Apple and Google', () => {
    assert.deepEqual(oauthProvidersFor('staging'), ['apple', 'google']);
});

test('passkey preflight explains unavailable settings and unsupported browsers', () => {
    assert.equal(passkeyUnavailableReason({ passkeys_enabled: true }, true), null);
    assert.equal(passkeyUnavailableReason(null, true), null, 'failed settings read still permits an attempt');
    assert.match(passkeyUnavailableReason({ passkeys_enabled: false }, true), /isn't enabled/);
    assert.match(passkeyUnavailableReason({}, true), /isn't enabled/);
    assert.match(passkeyUnavailableReason({ passkeys_enabled: true }, false), /browser cannot use passkeys/);
});

test('the drift check names a provider switched off, and one the app does not offer', () => {
    assert.deepEqual(providerDrift(['apple', 'google'], { external: { apple: true, google: true, email: true } }), { missing: [], unlisted: [] });
    assert.deepEqual(providerDrift(['apple', 'google'], { external: { google: true } }), { missing: ['apple'], unlisted: [] });
    assert.deepEqual(providerDrift(['google'], { external: { apple: true, google: true } }), { missing: [], unlisted: ['apple'] });
    assert.deepEqual(providerDrift(['apple'], null), { missing: ['apple'], unlisted: [] });
});

test('all sign-in modes retain Apple and passkeys, with availability checked before starting', () => {
    const gate = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');
    assert.doesNotMatch(gate, /\{(?:oauth\.apple|passkeys) &&/);
    assert.match(gate, /Continue with Apple/);
    assert.match(gate, /Sign in with a passkey/);
    const start = gate.slice(gate.indexOf('async function startOAuth'), gate.indexOf('await signInWithOAuth(provider)'));
    assert.match(start, /await settingsBeforeSignIn\(\)/);
    assert.match(start, /if \(!providerAvailable\(data, provider\)\)/);
    const passkey = gate.slice(gate.indexOf('async function startPasskey'), gate.indexOf('const session = await signInWithPasskey'));
    assert.match(passkey, /passkeyUnavailableReason\(null, passkeysSupported\(\)\)/);
    assert.match(passkey, /passkeyUnavailableReason\(await settingsBeforeSignIn\(\), true\)/);
    const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
    assert.match(config, /NEXT_PUBLIC_AUTH_PROVIDERS: oauthProvidersFor\(identityConfig\.appEnv\)\.join\(','\)/);
    assert.ok(Object.isFrozen(AI_ENVIRONMENTS.production.oauthProviders));
});

test('only a successful read saying a provider is off stops its redirect', () => {
    assert.equal(providerAvailable(null, 'apple'), true, 'unreadable settings let the user try');
    assert.equal(providerAvailable({ external: { apple: false } }, 'apple'), false);
    assert.equal(providerAvailable({ external: { apple: true } }, 'apple'), true);
    assert.equal(providerAvailable({}, 'google'), false);
});

test('readAuthSettings never throws and returns null when it cannot read', async () => {
    assert.equal(await readAuthSettings('', 'k'), null);
    assert.equal(await readAuthSettings('https://x.test', 'k', 50, async () => { throw new Error('blocked'); }), null);
    assert.equal(await readAuthSettings('https://x.test', 'k', 50, async () => new Response('no', { status: 503 })), null);
    assert.equal(await readAuthSettings('https://x.test', 'k', 50, async () => Response.json(null)), null);
    assert.deepEqual(await readAuthSettings('https://x.test', 'k', 50, async () => Response.json({ external: { google: true } })), { external: { google: true } });
});

const NOW = Date.parse('2026-10-02T12:00:00Z');
const run = async (fetcher, nowMs = NOW) => {
    const lines = [];
    const code = await main({ fetcher, nowMs, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    return { code, text: lines.join('\n') };
};

test('the monitor passes only when it read the providers and they match', async () => {
    const ok = await run(async () => Response.json({ external: { apple: true, google: true, email: true } }));
    assert.equal(ok.code, 0);
    assert.match(ok.text, /^OK:/m);
    const off = await run(async () => Response.json({ external: { google: true } }));
    assert.equal(off.code, 1);
    assert.match(off.text, /DRIFT: apple is switched off/);
});

test('anything the monitor cannot read is "could not tell", never drift or a pass', async () => {
    for (const fetcher of [
        async () => { throw new Error('network'); },
        async () => new Response('x', { status: 500 }),
        async () => Response.json(null),
        async () => Response.json({}),
        async () => Response.json({ external: null }),
        async () => new Response('not json', { status: 200 }),
    ]) {
        assert.equal((await run(fetcher)).code, 2);
    }
});

test('the monitor warns 30 days before the recorded Apple secret expiry', async () => {
    assert.equal(daysUntil('2027-03-24', Date.parse('2027-03-14T00:00:00Z')), 10);
    assert.equal(daysUntil('bad', NOW), null);
    const live = async () => Response.json({ external: { apple: true, google: true } });
    assert.equal((await run(live, Date.parse('2026-10-02T00:00:00Z'))).code, 0, 'months away: OK');
    const soon = await run(live, Date.parse('2027-03-01T00:00:00Z'));
    assert.equal(soon.code, 1);
    assert.match(soon.text, /APPLE SECRET: .* expires on 2027-03-24 \(in 23 days\)/);
    const late = await run(live, Date.parse('2027-04-01T00:00:00Z'));
    assert.match(late.text, /8 days ago/);
});
