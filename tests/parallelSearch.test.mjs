// Capped chat search through Parallel MCP: external transport is scripted, not the model or resolver result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARALLEL_MCP_URL, PARALLEL_USER_AGENT, SearchError, searchWeb } from '../packages/adapters/parallelSearch.js';
import { SearchError as ExistingSearchError, SEARCH_LIMITS } from '../packages/adapters/exa.js';

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MODEL = 'vendor/verified-model';
const page = (n, over = {}) => ({ url: `https://example.com/${n}`, title: `Title ${n}`, excerpts: [`Excerpt ${n}`], ...over });
const output = (results = [page(1)]) => ({ search_id: 'search-fixture', session_id: SESSION, results });
const tools = [{ name: 'web_search', inputSchema: { type: 'object', properties: {
    objective: { type: 'string' }, search_queries: { type: 'array', items: { type: 'string' } },
    session_id: { type: 'string' }, model_name: { type: 'string' },
}, required: ['objective', 'search_queries'] } }];
const envelope = (id, result) => ({ jsonrpc: '2.0', id, result });
const json = (body) => Response.json(body);
const aborting = (signal) => new Promise((_, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});
function fixture({ results, toolResult, transform, onRequest, onDelete } = {}) {
    const seen = [], closed = [];
    const fetchImpl = async (url, init) => {
        if (init.method === 'DELETE') {
            closed.push({ url: String(url), init, headers: new Headers(init.headers) });
            return onDelete ? onDelete(closed.at(-1)) : new Response(null, { status: 204 });
        }
        const request = JSON.parse(init.body);
        const row = { url: String(url), init, request, headers: new Headers(init.headers) };
        seen.push(row);
        const special = await onRequest?.(row);
        if (special) return special;
        if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = request.method === 'initialize'
            ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'parallel-fixture', version: '1' } }
            : request.method === 'tools/list' ? { tools }
                : toolResult || { structuredContent: output(results) };
        const body = envelope(request.id, result);
        const response = transform ? transform(body, row) : json(body);
        if (request.method === 'initialize') response.headers.set('Mcp-Session-Id', 'transport-session');
        return response;
    };
    return { seen, closed, fetchImpl };
}
const search = (f, over = {}) => searchWeb({ query: ' latest stable release ', sessionId: SESSION, modelName: MODEL, fetchImpl: f.fetchImpl, ...over });
async function errorCode(promise) {
    try { await promise; assert.fail('expected a typed search failure'); }
    catch (err) { assert.ok(err instanceof SearchError, String(err)); assert.equal(err.message, err.code); return err.code; }
}
function sse(body) {
    const encoded = new TextEncoder().encode(`: heartbeat\r\n\r\nevent: message\r\ndata: ${JSON.stringify(body)}\r\n\r\n`);
    return new Response(new ReadableStream({ start(controller) {
        for (let start = 0; start < encoded.length; start += 7) controller.enqueue(encoded.slice(start, start + 7));
        controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('uses the existing safe SearchError type and the fixed anonymous MCP endpoint', () => {
    assert.equal(SearchError, ExistingSearchError);
    assert.equal(PARALLEL_MCP_URL, 'https://search.parallel.ai/mcp');
    assert.match(PARALLEL_USER_AGENT, /veyrnox/i);
    assert.match(PARALLEL_USER_AGENT, /veyrnox\.ai|github\.com\/aljobson\/Veyrnox\.ai/i);
});

test('initializes, discovers and calls web_search with UA on every request and no credential forwarding', async () => {
    const f = fixture();
    const answer = await search(f);
    assert.deepEqual(answer, { results: [{ title: 'Title 1', url: 'https://example.com/1', text: 'Excerpt 1' }], costUsd: null });
    assert.deepEqual(f.seen.map(row => row.request.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    for (const row of f.seen) {
        assert.equal(row.url, PARALLEL_MCP_URL);
        assert.equal(row.init.method, 'POST');
        assert.equal(row.init.redirect, 'error', 'redirects cannot move protocol headers to a different host');
        assert.equal(row.headers.get('user-agent'), PARALLEL_USER_AGENT);
        assert.match(row.headers.get('accept'), /application\/json/);
        assert.match(row.headers.get('accept'), /text\/event-stream/);
        assert.match(row.headers.get('content-type'), /application\/json/);
        assert.equal(row.headers.get('authorization'), null);
        assert.equal(row.headers.get('x-api-key'), null);
    }
    const protocol = f.seen[0].request.params.protocolVersion;
    assert.equal(typeof protocol, 'string');
    assert.ok(protocol.length > 0);
    for (const row of f.seen.slice(1)) {
        assert.equal(row.headers.get('mcp-session-id'), 'transport-session');
        assert.equal(row.headers.get('mcp-protocol-version'), protocol);
    }
    const call = f.seen.at(-1).request;
    assert.equal(call.params.name, 'web_search');
    assert.deepEqual(call.params.arguments, {
        objective: 'latest stable release', search_queries: ['latest stable release'], session_id: SESSION, model_name: MODEL,
    });
    assert.equal(f.closed.length, 1);
    assert.equal(f.closed[0].url, PARALLEL_MCP_URL);
    assert.equal(f.closed[0].init.redirect, 'error');
    assert.equal(f.closed[0].headers.get('mcp-session-id'), 'transport-session');
    assert.equal(f.closed[0].headers.get('mcp-protocol-version'), protocol);
    assert.equal(f.closed[0].headers.get('user-agent'), PARALLEL_USER_AGENT);
    assert.equal(f.closed[0].headers.has('authorization'), false);
});

test('session cleanup errors and deadline do not discard a successful search', async () => {
    for (const onDelete of [() => { throw new Error('cleanup failure'); }, () => new Response(null, { status: 405 }), row => aborting(row.init.signal)]) {
        const f = fixture({ onDelete });
        assert.equal((await search(f, { timeoutMs: 30 })).results[0].text, 'Excerpt 1');
        assert.equal(f.closed.length, 1);
    }
});

test('caller cancellation during session cleanup still propagates the caller reason', async () => {
    const ac = new AbortController(), reason = new DOMException('Caller stopped', 'AbortError');
    const f = fixture({ onDelete: row => {
        queueMicrotask(() => ac.abort(reason));
        return aborting(row.init.signal);
    } });
    await assert.rejects(search(f, { signal: ac.signal }), err => err === reason);
});

test('supports streamed SSE envelopes split into small CRLF chunks', async () => {
    const f = fixture({ results: [page(1, { excerpts: ['A Unicode source: café 🌍'] })], transform: body => sse(body) });
    assert.equal((await search(f)).results[0].text, 'A Unicode source: café 🌍');
});

test('accepts CR-only SSE framing and CRLF split after CR', async () => {
    for (const ending of ['\r', '\r\n']) {
        const f = fixture({ transform: body => new Response(new ReadableStream({ start(controller) {
            const encoded = new TextEncoder().encode(`data: ${JSON.stringify(body)}${ending}${ending}`);
            for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
            controller.close();
        } }), { headers: { 'content-type': 'text/event-stream' } }) });
        assert.equal((await search(f)).results[0].text, 'Excerpt 1');
    }
});

test('rejects oversized responses and unsupported discovered schemas safely', async () => {
    const huge = fixture({ onRequest: () => Response.json({ padding: 'x'.repeat(260000) }) });
    assert.equal(await errorCode(search(huge)), 'search_unavailable');
    const wrong = fixture({ transform: (body, row) => row.request.method === 'tools/list'
        ? json(envelope(body.id, { tools: [{ name: 'web_search', inputSchema: { properties: { objective: { type: 'number' } } } }] })) : json(body) });
    assert.equal(await errorCode(search(wrong)), 'search_unavailable');
});

test('accepts the MCP content-text JSON compatibility shape', async () => {
    const f = fixture({ toolResult: { content: [{ type: 'text', text: JSON.stringify(output([page(2)])) }] } });
    assert.deepEqual((await search(f)).results, [{ title: 'Title 2', url: 'https://example.com/2', text: 'Excerpt 2' }]);
});

test('joins excerpts and preserves the same 3 by 2000 character ceiling used by capped chat pricing', async () => {
    const f = fixture({ results: [page(1, { excerpts: ['First', 'Second'] }), page(2, { title: 'T'.repeat(900), excerpts: ['x'.repeat(50000)] }), page(3), page(4)] });
    const answer = await search(f, { query: 'q'.repeat(900) });
    assert.equal(answer.results.length, SEARCH_LIMITS.results);
    assert.match(answer.results[0].text, /First\s+Second/);
    assert.equal(answer.results[1].text.length, SEARCH_LIMITS.charsPerResult);
    assert.equal(answer.results[1].title.length, SEARCH_LIMITS.titleChars);
    assert.equal(f.seen.at(-1).request.params.arguments.objective.length, SEARCH_LIMITS.queryChars);
    assert.equal(f.seen.at(-1).request.params.arguments.search_queries[0].length, SEARCH_LIMITS.queryChars);
    assert.equal(answer.costUsd, null, 'usage counts are not an invented USD cost');
});

test('keeps only usable http(s) URLs without credentials, and only the first three valid results', async () => {
    const bad = ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'ftp://example.com/file',
        'https://user:secret@example.com/path', 'not a URL', `https://example.com/${'x'.repeat(2100)}`];
    const f = fixture({ results: [...bad.map((url, n) => page(n, { url })), page(10, { excerpts: ['   '] }),
        page(11, { excerpts: 7 }), null, 'junk', page(12, { url: 'http://example.com/plain' }), page(13), page(14), page(15)] });
    assert.deepEqual((await search(f)).results.map(row => row.url), ['http://example.com/plain', 'https://example.com/13', 'https://example.com/14']);
});

test('empty results are normal and missing titles do not crash', async () => {
    assert.deepEqual((await search(fixture({ results: [] }))).results, []);
    const f = fixture({ results: [page(1, { title: null, excerpts: ['Good text'] })] });
    assert.deepEqual((await search(f)).results, [{ title: '', url: 'https://example.com/1', text: 'Good text' }]);
});

test('invalid or empty queries are refused without a network request', async () => {
    for (const query of ['', '   ', null, undefined, 42, {}]) {
        const f = fixture();
        assert.equal(await errorCode(search(f, { query })), 'search_request_rejected');
        assert.equal(f.seen.length, 0);
    }
});

test('keeps the supplied conversation and exact trusted model values on independent searches', async () => {
    const f = fixture();
    await search(f); await search(f);
    const calls = f.seen.filter(row => row.request.method === 'tools/call');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(row => [row.request.params.arguments.session_id, row.request.params.arguments.model_name]), [[SESSION, MODEL], [SESSION, MODEL]]);
});

test('HTTP errors are typed and never include upstream account/query details', async () => {
    const secret = 'account alice@example.invalid key sk-secret query private';
    for (const [status, expected] of [[400, 'search_request_rejected'], [401, 'search_auth_failed'], [402, 'search_payment_required'],
        [403, 'search_auth_failed'], [429, 'search_rate_limited'], [500, 'search_unavailable'], [503, 'search_unavailable']]) {
        const f = fixture({ onRequest: () => new Response(secret, { status }) });
        assert.equal(await errorCode(search(f)), expected, String(status));
        assert.equal(f.seen.length, 1, 'there is no retry or fallback');
    }
});

test('RPC errors, tool errors, absent tools and malformed protocol payloads fail safely', async () => {
    const cases = [
        (body, row) => row.request.method === 'tools/call' ? json({ jsonrpc: '2.0', id: body.id, error: { code: -32603, message: 'sk-secret' } }) : json(body),
        (body, row) => row.request.method === 'tools/call' ? json(envelope(body.id, { isError: true, content: [{ type: 'text', text: 'sk-secret' }] })) : json(body),
        (body, row) => row.request.method === 'tools/list' ? json(envelope(body.id, { tools: [] })) : json(body),
        (body, row) => row.request.method === 'tools/call' ? json({ ...body, id: 'wrong-id' }) : json(body),
        (body, row) => row.request.method === 'tools/call' ? new Response('<html>sk-secret</html>', { headers: { 'content-type': 'application/json' } }) : json(body),
        (body, row) => row.request.method === 'tools/call' ? json(envelope(body.id, { content: [{ type: 'text', text: 'not JSON sk-secret' }] })) : json(body),
    ];
    for (const transform of cases) assert.equal(await errorCode(search(fixture({ transform }))), 'search_unavailable');
    const f = fixture({ onRequest: () => { throw new Error('socket failed sk-secret'); } });
    assert.equal(await errorCode(search(f)), 'search_unavailable');
});

test('each awaited phase uses the same bounded search timeout', async () => {
    for (const phase of ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']) {
        const f = fixture({ onRequest: row => row.request.method === phase ? aborting(row.init.signal) : undefined });
        assert.equal(await errorCode(search(f, { timeoutMs: 15 })), 'search_timeout', phase);
    }
});

test('the timeout covers response body consumption', async () => {
    const f = fixture({ onRequest: row => row.request.method === 'tools/call' ? new Response(new ReadableStream({ start(controller) {
        row.init.signal.addEventListener('abort', () => controller.error(row.init.signal.reason), { once: true });
    } }), { headers: { 'content-type': 'application/json' } }) : undefined });
    assert.equal(await errorCode(search(f, { timeoutMs: 15 })), 'search_timeout');
});

test('a whole-operation deadline cannot restart for every request', async () => {
    const f = fixture({ onRequest: async row => {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 20);
            row.init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(row.init.signal.reason); }, { once: true });
        });
    } });
    assert.equal(await errorCode(search(f, { timeoutMs: 45 })), 'search_timeout');
});

test('a pre-aborted caller makes no requests and cancellation keeps the caller reason', async () => {
    const ac = new AbortController();
    const reason = new DOMException('Caller stopped', 'AbortError');
    ac.abort(reason);
    const f = fixture();
    await assert.rejects(search(f, { signal: ac.signal }), err => err === reason);
    assert.equal(f.seen.length, 0);
});

test('cancels a pending tools call without disguising it as provider or timeout error', async () => {
    const ac = new AbortController();
    const reason = new DOMException('Caller stopped', 'AbortError');
    const f = fixture({ onRequest: row => {
        if (row.request.method !== 'tools/call') return;
        queueMicrotask(() => ac.abort(reason));
        return aborting(row.init.signal);
    } });
    await assert.rejects(search(f, { signal: ac.signal, timeoutMs: 2000 }), err => err === reason);
    assert.equal(f.seen.at(-1).request.method, 'tools/call');
});
