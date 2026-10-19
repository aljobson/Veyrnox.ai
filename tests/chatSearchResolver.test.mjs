// Deployment provider choices share one resolver across the capped search offer and actual turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChatSearch, searchChatWeb } from '../lib/chatSearch.js';
import { EXA_SEARCH_URL, SearchError } from '../packages/adapters/exa.js';
import { PARALLEL_MCP_URL } from '../packages/adapters/parallelSearch.js';

const resolve = (env) => resolveChatSearch(env);
const safeError = async (promise) => {
    try { await promise; assert.fail('expected failure'); }
    catch (err) { assert.ok(err instanceof SearchError, String(err)); return err.code; }
};

test('fresh configuration selects Parallel and a configured Exa key preserves the existing provider', () => {
    for (const env of [undefined, {}, { EXA_API_KEY: '' }, { CHAT_SEARCH_PROVIDER: '' }, { EXA_API_KEY: '', CHAT_SEARCH_PROVIDER: '' }]) {
        assert.deepEqual(resolve(env), { provider: 'parallel', apiKey: '' });
    }
    assert.deepEqual(resolve({ EXA_API_KEY: 'configured-key' }), { provider: 'exa', apiKey: 'configured-key' });
    assert.deepEqual(resolve({ EXA_API_KEY: ' key-preserved ', CHAT_SEARCH_PROVIDER: '' }), { provider: 'exa', apiKey: ' key-preserved ' });
});

test('explicit provider choices override auto selection without discarding or borrowing credentials', () => {
    for (const EXA_API_KEY of [undefined, '', 'configured-key']) {
        assert.deepEqual(resolve({ CHAT_SEARCH_PROVIDER: 'parallel', EXA_API_KEY }), { provider: 'parallel', apiKey: '' });
        assert.deepEqual(resolve({ CHAT_SEARCH_PROVIDER: 'off', EXA_API_KEY }), { provider: 'off', apiKey: '' });
    }
    assert.deepEqual(resolve({ CHAT_SEARCH_PROVIDER: 'exa', EXA_API_KEY: ' keep-me ' }), { provider: 'exa', apiKey: ' keep-me ' });
    assert.deepEqual(resolve({ CHAT_SEARCH_PROVIDER: 'exa' }), { provider: 'off', apiKey: '' });
    assert.deepEqual(resolve({ CHAT_SEARCH_PROVIDER: 'exa', EXA_API_KEY: '' }), { provider: 'off', apiKey: '' });
});

test('unsupported and malformed explicit provider settings fail closed', () => {
    for (const value of ['invalid', 'EXA', 'PARALLEL', ' parallel ', 'none', true, 7, null, {}]) {
        assert.deepEqual(resolve({ CHAT_SEARCH_PROVIDER: value, EXA_API_KEY: 'existing-key' }), { provider: 'off', apiKey: '' }, String(value));
    }
});

test('Exa dispatch uses the real bounded adapter and the configured key exactly', async () => {
    const seen = [];
    const answer = await searchChatWeb({ env: { EXA_API_KEY: ' key-preserved ' }, query: ' current release ', fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return Response.json({ results: [{ title: 'Source', url: 'https://example.com/release', text: 'Current release' }], costDollars: { total: 0.007 } });
    } });
    assert.equal(seen.length, 1); assert.equal(seen[0].url, EXA_SEARCH_URL);
    assert.equal(seen[0].init.headers['x-api-key'], ' key-preserved ');
    assert.equal(JSON.parse(seen[0].init.body).query, 'current release');
    assert.deepEqual(answer, { results: [{ title: 'Source', url: 'https://example.com/release', text: 'Current release' }], costUsd: 0.007 });
});

test('explicit Parallel dispatch forwards trusted conversation metadata but no Exa credential', async () => {
    const seen = [];
    const answer = await searchChatWeb({ env: { CHAT_SEARCH_PROVIDER: 'parallel', EXA_API_KEY: 'must-not-leak' },
        query: 'release', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', modelName: 'vendor/exact-model',
        fetchImpl: async (url, init) => {
            const request = JSON.parse(init.body); seen.push({ url, init, request });
            if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
            const result = request.method === 'initialize' ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
                : request.method === 'tools/list' ? { tools: [{ name: 'web_search', inputSchema: { type: 'object', required: ['objective', 'search_queries'], properties: { objective: { type: 'string' }, search_queries: { type: 'array' } } } }] }
                    : { structuredContent: { results: [{ url: 'https://example.com/release', title: 'Source', excerpts: ['Current release'] }] } };
            return Response.json({ jsonrpc: '2.0', id: request.id, result });
        } });
    assert.equal(answer.results[0].text, 'Current release');
    assert.equal(seen.length, 4);
    assert.ok(seen.every(row => row.url === PARALLEL_MCP_URL));
    assert.ok(seen.every(row => !JSON.stringify(row.init).includes('must-not-leak')));
    assert.equal(seen.at(-1).request.params.arguments.session_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(seen.at(-1).request.params.arguments.model_name, 'vendor/exact-model');
});

test('off and invalid configuration refuse without network traffic', async () => {
    for (const env of [{ CHAT_SEARCH_PROVIDER: 'off' }, { CHAT_SEARCH_PROVIDER: 'invalid', EXA_API_KEY: 'key' }, { CHAT_SEARCH_PROVIDER: 'exa' }]) {
        let calls = 0;
        assert.equal(await safeError(searchChatWeb({ env, query: 'release', fetchImpl: async () => { calls++; throw new Error('unexpected network'); } })), 'search_not_configured');
        assert.equal(calls, 0);
    }
});

test('selected-provider failures never silently fallback or retry', async () => {
    for (const [env, expectedUrl] of [[{ EXA_API_KEY: 'key' }, EXA_SEARCH_URL], [{ CHAT_SEARCH_PROVIDER: 'parallel', EXA_API_KEY: 'key' }, PARALLEL_MCP_URL], [{}, PARALLEL_MCP_URL]]) {
        const urls = [];
        assert.equal(await safeError(searchChatWeb({ env, query: 'release', fetchImpl: async url => {
            urls.push(url); return new Response('private upstream detail', { status: 429 });
        } })), 'search_rate_limited');
        assert.deepEqual(urls, [expectedUrl]);
    }
});
