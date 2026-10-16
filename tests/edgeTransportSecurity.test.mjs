import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHttpsRedirect, stripTechnologyHeaders } from '../lib/edgeTransportSecurity.js';

test('HTTP apex and www canonicalize to HTTPS without losing path or query', () => {
    const insecure = canonicalHttpsRedirect(new Request('http://veyrnox.ai/path?q=1'));
    assert.equal(insecure.status, 308);
    assert.equal(insecure.headers.get('location'), 'https://veyrnox.ai/path?q=1');
    const www = canonicalHttpsRedirect(new Request('https://www.veyrnox.ai/other'));
    assert.equal(www.headers.get('location'), 'https://veyrnox.ai/other');
    assert.equal(canonicalHttpsRedirect(new Request('https://veyrnox.ai/')), null);
    assert.equal(canonicalHttpsRedirect(new Request('http://staging.veyrnox.ai/')), null);
});

test('framework fingerprints are stripped while response semantics survive', async () => {
    const secured = stripTechnologyHeaders(new Response('ok', {
        status: 201,
        headers: { 'x-powered-by': 'Next.js', 'x-opennext': '1', 'content-type': 'text/plain' },
    }));
    assert.equal(secured.status, 201);
    assert.equal(secured.headers.get('x-powered-by'), null);
    assert.equal(secured.headers.get('x-opennext'), null);
    assert.equal(secured.headers.get('content-type'), 'text/plain');
    assert.equal(await secured.text(), 'ok');
});
