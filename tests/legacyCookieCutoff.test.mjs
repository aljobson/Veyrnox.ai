import test from 'node:test';
import assert from 'node:assert/strict';

const {
    LEGACY_COOKIE_CUTOFF_MS,
    isLegacyCookieAllowed,
    getApiKeyFromCookies,
} = await import('../lib/legacyCookieCutoff.js');

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

test('cutoff constant is fixed at 2026-08-23 UTC', () => {
    assert.equal(LEGACY_COOKIE_CUTOFF_MS, Date.UTC(2026, 7, 23));
});

test('isLegacyCookieAllowed is true before the cutoff', () => {
    assert.equal(isLegacyCookieAllowed(LEGACY_COOKIE_CUTOFF_MS - 1), true);
});

test('isLegacyCookieAllowed is false at and after the cutoff', () => {
    assert.equal(isLegacyCookieAllowed(LEGACY_COOKIE_CUTOFF_MS), false);
    assert.equal(isLegacyCookieAllowed(LEGACY_COOKIE_CUTOFF_MS + 1_000_000), false);
});

test('prefers __Host-muapi_key over legacy even before cutoff', () => {
    const originalNow = Date.now;
    Date.now = () => LEGACY_COOKIE_CUTOFF_MS - 1;
    try {
        const req = makeRequest({
            '__Host-muapi_key': 'host-key',
            'muapi_key': 'legacy-key',
        });
        assert.equal(getApiKeyFromCookies(req), 'host-key');
    } finally {
        Date.now = originalNow;
    }
});

test('falls back to legacy muapi_key strictly before the cutoff', () => {
    const originalNow = Date.now;
    Date.now = () => LEGACY_COOKIE_CUTOFF_MS - 1;
    try {
        const req = makeRequest({ 'muapi_key': 'legacy-key' });
        assert.equal(getApiKeyFromCookies(req), 'legacy-key');
    } finally {
        Date.now = originalNow;
    }
});

test('returns undefined when only legacy cookie present past cutoff', () => {
    const originalNow = Date.now;
    Date.now = () => LEGACY_COOKIE_CUTOFF_MS + 60_000;
    try {
        const req = makeRequest({ 'muapi_key': 'legacy-key' });
        assert.equal(getApiKeyFromCookies(req), undefined);
    } finally {
        Date.now = originalNow;
    }
});

test('still honors __Host-muapi_key past cutoff', () => {
    const originalNow = Date.now;
    Date.now = () => LEGACY_COOKIE_CUTOFF_MS + 60_000;
    try {
        const req = makeRequest({ '__Host-muapi_key': 'host-key' });
        assert.equal(getApiKeyFromCookies(req), 'host-key');
    } finally {
        Date.now = originalNow;
    }
});

test('returns undefined when no cookies present', () => {
    assert.equal(getApiKeyFromCookies(makeRequest({})), undefined);
});
