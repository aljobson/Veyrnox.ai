import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout } from '../packages/adapters/lemonsqueezy.js';

const TOP_UP_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const OK_URL = 'https://veyrnox-ai.lemonsqueezy.com/checkout/custom/5e8b546c-c561-4a2c-a586-40c18bb2a195?signature=abc';

function recorder(response = { data: { attributes: { url: OK_URL } } }, status = 201) {
    const calls = [];
    const fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/vnd.api+json' } });
    };
    return { calls, fetch };
}

const input = { variantId: '2120823', topUpId: TOP_UP_ID, expiresAt: '2026-09-13T10:00:00.000Z' };
const cfg = (fetch, over = {}) => ({ fetch, apiKey: 'test_key', storeId: '473468', publicHost: 'https://veyrnox.ai', ...over });

test('posts a JSON:API checkout to the constant LemonSqueezy host with bearer auth', async () => {
    const { calls, fetch } = recorder();
    const res = await createCheckout(input, cfg(fetch));
    assert.deepEqual(res, { ok: true, url: OK_URL });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.lemonsqueezy.com/v1/checkouts');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test_key');
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.api+json');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/vnd.api+json');
});

test('carries the Top-up id in custom data, the redirect from PUBLIC_HOST, store and variant', async () => {
    const { calls, fetch } = recorder();
    await createCheckout(input, cfg(fetch));
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.data.type, 'checkouts');
    assert.deepEqual(body.data.attributes.checkout_data.custom, { top_up_id: TOP_UP_ID });
    assert.equal(body.data.attributes.product_options.redirect_url, `https://veyrnox.ai/app/credits?top_up=${TOP_UP_ID}`);
    assert.deepEqual(body.data.attributes.product_options.enabled_variants, [2120823]);
    assert.equal(body.data.attributes.expires_at, '2026-09-13T10:00:00.000Z');
    assert.deepEqual(body.data.relationships.store.data, { type: 'stores', id: '473468' });
    assert.deepEqual(body.data.relationships.variant.data, { type: 'variants', id: '2120823' });
});

test('no input reaches the request host', async () => {
    const { calls, fetch } = recorder();
    await createCheckout({ ...input, variantId: '1@evil.example.com' }, cfg(fetch));
    await createCheckout({ ...input, topUpId: 'x/../../evil' }, cfg(fetch));
    await createCheckout(input, cfg(fetch, { storeId: 'evil.example.com' }));
    assert.equal(calls.length, 0, 'invalid ids are refused before any fetch');

    await createCheckout(input, cfg(fetch, { publicHost: 'https://evil.example.com' }));
    assert.equal(new URL(calls[0].url).host, 'api.lemonsqueezy.com');
});

test('refuses a non-https PUBLIC_HOST and a missing api key without fetching', async () => {
    const { calls, fetch } = recorder();
    assert.equal((await createCheckout(input, cfg(fetch, { publicHost: 'http://veyrnox.ai' }))).ok, false);
    assert.equal((await createCheckout(input, cfg(fetch, { publicHost: 'not a url' }))).ok, false);
    assert.equal((await createCheckout(input, cfg(fetch, { apiKey: '' }))).ok, false);
    assert.equal(calls.length, 0);
});

test('a non-2xx response is an error that does not echo the vendor body', async () => {
    const { fetch } = recorder({ errors: [{ detail: 'secret vendor detail' }] }, 422);
    const res = await createCheckout(input, cfg(fetch));
    assert.equal(res.ok, false);
    assert.equal(res.error, 'lemonsqueezy 422');
});

test('a checkout url off the LemonSqueezy domain or not https is rejected', async () => {
    for (const url of ['https://evil.example.com/checkout', 'https://lemonsqueezy.com.evil.com/x', 'http://veyrnox-ai.lemonsqueezy.com/x', undefined]) {
        const { fetch } = recorder({ data: { attributes: { url } } });
        const res = await createCheckout(input, cfg(fetch));
        assert.equal(res.ok, false, String(url));
    }
});

test('a transport failure is an error, not a throw', async () => {
    const fetch = async () => { throw new Error('boom'); };
    const res = await createCheckout(input, cfg(fetch));
    assert.equal(res.ok, false);
});
