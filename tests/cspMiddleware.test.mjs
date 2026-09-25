import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { contentSecurityPolicy } from '../lib/contentSecurityPolicy.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){ return next(s==='next/server'?'next/server.js':s,c); }`));
const { NextRequest } = await import('next/server.js');
const { middleware } = await import('../middleware.js');

test('HTML receives fresh matching CSP/renderer nonces and cannot trust inbound policy', async () => {
    const seen = [];
    for (const path of ['/app','/app/credits','/auth/callback']) {
        const response = await middleware(new NextRequest(`https://example.test${path}`, { headers: {
            'x-nonce': 'forged', 'Content-Security-Policy': "script-src 'unsafe-inline'", 'x-veyrnox-auth-id': 'victim',
        }}));
        assert.equal(response.status, 200);
        const policy = response.headers.get('content-security-policy');
        const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
        assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
        assert.equal(response.headers.get('x-middleware-request-x-nonce'), nonce);
        assert.equal(response.headers.get('x-middleware-request-content-security-policy'), policy);
        assert.equal(response.headers.get('x-middleware-request-x-veyrnox-auth-id'), null);
        assert.ok(!policy.match(/script-src[^;]*unsafe-inline/));
        assert.match(response.headers.get('cache-control'), /no-store/);
        seen.push(nonce);
    }
    assert.equal(new Set(seen).size, 3);
});

test('API requests still require a verified token, even with forged identity/nonce', async () => {
    const before = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    try {
        const response = await middleware(new NextRequest('https://example.test/api/v1/account', { headers: {
            'x-veyrnox-auth-id': 'victim', 'x-nonce': 'forged',
        }}));
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('x-middleware-next'), null);
    } finally {
        if (before === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = before;
    }
});

test('nonce policy preserves the existing non-script directives and rejects header injection', () => {
    const base = contentSecurityPolicy();
    const nonce = contentSecurityPolicy('AAAAAAAAAAAAAAAAAAAAAA==');
    const withoutScript = (s) => s.split(';').filter(x => !x.trim().startsWith('script-src')).join(';');
    assert.equal(withoutScript(base), withoutScript(nonce));
    assert.ok(!nonce.includes('unsafe-eval'));
    assert.throws(() => contentSecurityPolicy("abc'; script-src *"), /invalid CSP nonce/);
});
