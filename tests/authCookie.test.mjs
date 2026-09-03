import test from 'node:test';
import assert from 'node:assert/strict';

const {
    getApiKeyFromCookies,
    getApiKeyFromCookieStore,
} = await import('../lib/authCookie.js');

// Next.js RSC cookie store shape: `cookieStore.get(name)` returns `{ value }`.
function makeCookieStore(cookies) {
    return {
        get(name) {
            return name in cookies ? { value: cookies[name] } : undefined;
        },
    };
}

// Minimal NextRequest-like cookie jar for tests.
function makeRequest(cookies) {
    return {
        cookies: {
            get(name) {
                return name in cookies ? { value: cookies[name] } : undefined;
            },
        },
    };
}

test('reads __Host-muapi_key cookie', () => {
    const req = makeRequest({ '__Host-muapi_key': 'host-key' });
    assert.equal(getApiKeyFromCookies(req), 'host-key');
});

test('ignores the legacy unprefixed muapi_key cookie', () => {
    const req = makeRequest({ 'muapi_key': 'legacy-key' });
    assert.equal(getApiKeyFromCookies(req), undefined);
});

test('prefers __Host- cookie when both are present', () => {
    const req = makeRequest({
        '__Host-muapi_key': 'host-key',
        'muapi_key': 'legacy-key',
    });
    assert.equal(getApiKeyFromCookies(req), 'host-key');
});

test('returns undefined when no cookies present', () => {
    assert.equal(getApiKeyFromCookies(makeRequest({})), undefined);
});

test('cookie-store helper reads __Host- cookie', () => {
    const store = makeCookieStore({ '__Host-muapi_key': 'host-key' });
    assert.equal(getApiKeyFromCookieStore(store), 'host-key');
});

test('cookie-store helper ignores legacy cookie', () => {
    const store = makeCookieStore({ 'muapi_key': 'legacy-key' });
    assert.equal(getApiKeyFromCookieStore(store), undefined);
});
