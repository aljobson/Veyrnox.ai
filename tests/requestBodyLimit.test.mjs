import test from 'node:test';
import assert from 'node:assert/strict';
import { limitRequestBody, GENERATION_BODY_LIMIT, JSON_BODY_LIMIT, WEBHOOK_BODY_LIMIT } from '../lib/requestBodyLimit.js';
const request = (body, path = '/api/v1/generations', headers = {}) => new Request(`https://veyrnox.test${path}`, { method: 'POST', body, headers, duplex: 'half' });

// Workers exposes an empty stream for GET/HEAD with Content-Length: 0,
// although the standard Request constructor forbids a body on those methods.
function readRequestWithStream(method, body = new Uint8Array()) {
    const original = request(body, '/media/social/synthetic-token', { 'content-length': '0' });
    return {
        ...Object.fromEntries(['url', 'headers', 'body', 'redirect', 'signal'].map(key => [key, original[key]])),
        method,
        cf: { country: 'GB' },
    };
}

for (const method of ['GET', 'HEAD']) {
    test(`${method} with an empty stream and Content-Length: 0 reaches the handler`, async () => {
        const original = readRequestWithStream(method);
        const result = await limitRequestBody(original);
        assert.equal(result.response, undefined);
        assert.equal(result.request.method, method);
        assert.equal(result.request.url, original.url);
        assert.equal(result.request.headers.get('content-length'), '0');
        assert.equal(result.request.body, null);
    });

    test(`${method} with bytes is still rejected even when Content-Length claims zero`, async () => {
        const result = await limitRequestBody(readRequestWithStream(method, 'unexpected body'));
        assert.equal(result.response.status, 400);
        assert.deepEqual(await result.response.json(), { error: 'invalid_body' });
    });
}

test('GET streams still enforce the body ceiling', async () => {
    const result = await limitRequestBody(readRequestWithStream('GET', new Uint8Array(JSON_BODY_LIMIT + 1)));
    assert.equal(result.response.status, 413);
});

test('oversized bodies are rejected without trusting content-length', async () => {
    const { response } = await limitRequestBody(request('x'.repeat(JSON_BODY_LIMIT + 1), '/api/v1/other', { 'content-length': '1' }));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('generation requests admit a worst-case escaped 30,000-character prompt', async () => {
    const prompt = String.fromCharCode(1).repeat(30000);
    const body = JSON.stringify({ model_id: 'flux-2-pro', idempotency_key: 'generation-body-limit', inputs: { prompt } });
    assert.ok(new TextEncoder().encode(body).length > JSON_BODY_LIMIT);
    const result = await limitRequestBody(request(body));
    assert.equal(result.response, undefined);
    assert.equal((await result.request.json()).inputs.prompt.length, 30000);
    assert.equal((await limitRequestBody(request('x'.repeat(GENERATION_BODY_LIMIT + 1)))).response.status, 413);
});

test('developer generation requests use the generation body envelope', async () => {
    const prompt = String.fromCharCode(1).repeat(30000);
    const body = JSON.stringify({ model_id: 'flux-2-pro', idempotency_key: 'developer-body-limit', inputs: { prompt } });
    assert.ok(new TextEncoder().encode(body).length > JSON_BODY_LIMIT);
    const result = await limitRequestBody(request(body, '/api/v1/developer/generations'));
    assert.equal(result.response, undefined);
    assert.equal((await result.request.json()).inputs.prompt.length, 30000);
});

test('MCP requests admit the same worst-case escaped 30,000-character prompt envelope', async () => {
    const prompt = String.fromCharCode(1).repeat(30000);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt } } });
    assert.ok(new TextEncoder().encode(body).length > JSON_BODY_LIMIT);
    const result = await limitRequestBody(request(body, '/api/v1/mcp'));
    assert.equal(result.response, undefined);
    assert.equal((await result.request.json()).params.arguments.prompt.length, 30000);
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

test('framework request wrappers retain body and authentication headers', async () => {
    const original = request('{"username":"staging_test"}', '/api/v1/social-cinema/profile', {
        authorization: 'Bearer synthetic', 'content-type': 'application/json', 'idempotency-key': 'synthetic',
    });
    // A framework wrapper exposes Fetch fields without the native Request brand.
    const wrapper = Object.fromEntries(['url', 'method', 'headers', 'body', 'redirect', 'signal']
        .map(key => [key, original[key]]));
    const result = await limitRequestBody(wrapper);
    assert.equal(result.response, undefined);
    assert.equal(result.request.url, original.url);
    assert.equal(result.request.method, 'POST');
    assert.equal(result.request.headers.get('authorization'), 'Bearer synthetic');
    assert.equal(result.request.headers.get('idempotency-key'), 'synthetic');
    assert.deepEqual(await result.request.json(), { username: 'staging_test' });
});

test('only exact PATCH transfer routes permit bounded 5 MiB chunks',async()=>{
 const path='/api/v1/cinema/uploads/11111111-1111-4111-8111-111111111111/transfer';
 const make=(size,method='PATCH',suffix='')=>new Request(`https://test.invalid${path}${suffix}`,{method,body:new Uint8Array(size)});
 assert.ok((await limitRequestBody(make(5*1024*1024))).request);
 assert.equal((await limitRequestBody(make(5*1024*1024+1))).response.status,413);
 assert.equal((await limitRequestBody(make(JSON_BODY_LIMIT+1,'POST'))).response.status,413);
 assert.equal((await limitRequestBody(make(JSON_BODY_LIMIT+1,'PATCH','/extra'))).response.status,413);
});
