import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { developerApi } = await import('../lib/developerApi.js');
const { estimatedCredits } = await import('../lib/generationEstimate.js');
const { developerOpenApi } = await import('../lib/developerOpenApi.js');

const identity = {
    'x-veyrnox-auth-id': '33333333-3333-4333-8333-333333333333',
    'x-veyrnox-auth-email': 'developer@example.test',
    'x-veyrnox-auth-client-id': '11111111-1111-4111-8111-111111111111',
};
const request = (path, init = {}) => new Request(`https://veyrnox.test/api/v1/developer${path}`, {
    headers: { ...identity, ...(init.headers || {}) }, ...init,
});

test('credit estimates price images once and videos in five-second units', () => {
    assert.equal(estimatedCredits({ credits: 3, modality: 'text-to-image' }), 3);
    assert.equal(estimatedCredits({ credits: 7, modality: 'text-to-video', durations: [5, 10] }, 10), 14);
    assert.equal(estimatedCredits({ credits: 7, modality: 'text-to-video', durations: [5, 10] }, 8), null);
    assert.equal(estimatedCredits({ modality: 'text-to-image' }), null);
});

test('developer API refuses missing user and OAuth client identities', async () => {
    const anonymous = await developerApi(new Request('https://veyrnox.test/api/v1/developer'), []);
    assert.deepEqual([anonymous.status, await anonymous.json()], [401, { error: 'not_authenticated' }]);
    const browser = await developerApi(new Request('https://veyrnox.test/api/v1/developer', {
        headers: { 'x-veyrnox-auth-id': identity['x-veyrnox-auth-id'] },
    }), []);
    assert.deepEqual([browser.status, await browser.json()], [403, { error: 'oauth_client_required' }]);
    assert.match(browser.headers.get('www-authenticate'), /error="insufficient_scope"/);
});

test('developer API identifies the verified caller without exposing tokens', async () => {
    const response = await developerApi(request('/me'), ['me']);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        id: identity['x-veyrnox-auth-id'], email: 'developer@example.test',
        oauth_client_id: identity['x-veyrnox-auth-client-id'],
    });
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('developer generation writes require an explicit non-negative credit confirmation', async () => {
    for (const confirmed_credits of [undefined, -1, 1.5, '2']) {
        const body = { model_id: 'model', idempotency_key: '12345678', inputs: {} };
        if (confirmed_credits !== undefined) body.confirmed_credits = confirmed_credits;
        const response = await developerApi(request('/generations', { method: 'POST', body: JSON.stringify(body) }), ['generations']);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'confirmed_credits_required');
    }
});

test('developer API answers unauthenticated CORS preflight without cookies', async () => {
    const response = await developerApi(new Request('https://veyrnox.test/api/v1/developer/generations', { method: 'OPTIONS' }), ['generations']);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
});

test('OpenAPI documents every developer operation and OAuth security', () => {
    assert.equal(developerOpenApi.openapi, '3.1.0');
    assert.ok(developerOpenApi.components.securitySchemes.oauth.flows.authorizationCode);
    const operations = Object.values(developerOpenApi.paths).flatMap((path) => Object.values(path).map((op) => op.operationId));
    assert.deepEqual(operations.sort(), ['createGeneration', 'estimateGeneration', 'getApi', 'getBalance', 'getGeneration',
        'getGenerationAsset', 'getMe', 'listGenerations', 'listModels'].sort());
    assert.deepEqual(developerOpenApi.paths['/generations'].post.requestBody.content['application/json'].schema.required,
        ['model_id', 'idempotency_key', 'confirmed_credits', 'inputs']);
});

test('unknown and malformed generation paths fail without reaching storage', async () => {
    const malformed = await developerApi(request('/generations/nope'), ['generations', 'nope']);
    assert.deepEqual([malformed.status, await malformed.json()], [400, { error: 'invalid_job_id' }]);
    const missing = await developerApi(request('/anything'), ['anything']);
    assert.deepEqual([missing.status, await missing.json()], [404, { error: 'not_found' }]);
});
