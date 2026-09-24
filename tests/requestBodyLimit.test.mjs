import test from 'node:test';
import assert from 'node:assert/strict';
import { limitRequestBody, JSON_BODY_LIMIT, WEBHOOK_BODY_LIMIT } from '../lib/requestBodyLimit.js';
const request = (body, path = '/api/v1/generations', headers = {}) => new Request(`https://veyrnox.test${path}`, { method: 'POST', body, headers, duplex: 'half' });

test('oversized bodies are rejected without trusting content-length', async () => {
    const { response } = await limitRequestBody(request('x'.repeat(JSON_BODY_LIMIT + 1), undefined, { 'content-length': '1' }));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('webhook bytes survive unchanged including whitespace and non-ASCII content', async () => {
    const bytes = new TextEncoder().encode(' { "signature": "é" }\r\n');
    const result = await limitRequestBody(request(bytes, '/api/webhook/stripe'));
    assert.deepEqual(new Uint8Array(await result.request.arrayBuffer()), bytes);
    assert.equal(result.request.method, 'POST');
});

test('webhooks have a separate finite ceiling', async () => {
    assert.ok((await limitRequestBody(request('x'.repeat(JSON_BODY_LIMIT + 1), '/api/webhook/stripe'))).request);
    assert.equal((await limitRequestBody(request('x'.repeat(WEBHOOK_BODY_LIMIT + 1), '/api/webhook/stripe'))).response.status, 413);
});

test('a client that stalls after opening its body receives 408', async () => {
    const result = await limitRequestBody(request(new ReadableStream({})), 20);
    assert.equal(result.response.status, 408);
});
