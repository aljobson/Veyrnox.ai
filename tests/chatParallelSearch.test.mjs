import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChatTurn } from '../lib/chatTurn.js';
import { GET as getModels } from '../app/api/v1/chat/models/route.js';

const THREAD = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const MODEL = { id: 'chat-test', name: 'Test', provider: 'openrouter-chat', provider_endpoint: 'vendor/exact-model', modality: 'text', active: true,
    credits_5s: 1, chat_web_extra_credits: 2, chat_web_engine: 'capped' };
const savedFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => { globalThis.fetch = savedFetch; process.env = { ...savedEnv }; });

function fixture({ model = {}, replies = {}, web = true, env = {}, stream } = {}) {
    const calls = [], modelCalls = [], requests = [];
    const row = { ...MODEL, ...model };
    const rpc = async (name, args) => {
        calls.push({ name, args });
        const values = { check_generation_rate_limit: { ok: true }, chat_turn_context: { ok: true, user_id: 'user-test', model_id: row.id, history: [] },
            chat_stops_before_text: 0, read_user_credits: { balance: 10 }, provider_spend_admit_model: { ok: true },
            ledger_debit: { ok: true, job_id: JOB, balance_after: 7 }, job_submitted: { ok: true }, chat_complete_turn: { ok: true } };
        return name in replies ? replies[name] : values[name];
    };
    globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), ...init, message: JSON.parse(init.body) });
        const msg = requests.at(-1).message;
        assert.equal(String(url), 'https://search.parallel.ai/mcp');
        assert.equal(init.redirect, 'error');
        assert.match(new Headers(init.headers).get('user-agent'), /Veyrnox/i);
        if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = msg.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
            : msg.method === 'tools/list' ? { tools: [{ name: 'web_search', inputSchema: { type: 'object', required: ['objective', 'search_queries'], properties: { objective: { type: 'string' }, search_queries: { type: 'array' } } } }] }
                : { structuredContent: { results: [{ title: 'Current release', url: 'https://nodejs.org/en/blog/release', excerpts: ['Release facts from the web.'] }] }, content: [] };
        return Response.json({ jsonrpc: '2.0', id: msg.id, result });
    };
    const run = () => runChatTurn({ authId: AUTH, threadId: THREAD, cfg: {}, env: { OPENROUTER_API_KEY: 'model-fixture', ...env },
        body: { text: 'Find current Node release facts', idempotency_key: 'key-parallel-test', options: { web } },
        deps: { rpc, select: async () => [row], stream: async function* (args) { modelCalls.push(args); if (stream) yield* stream(args); else yield { delta: 'The release is current.' }; } } });
    return { run, calls, modelCalls, requests };
}

test('no-key capped turn uses actual resolver and MCP transport through context, sources and stored reply', async () => {
    const f = fixture();
    const response = await f.run();
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.deepEqual(f.requests.map(r => r.message.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    for (const r of f.requests) assert.equal(new Headers(r.headers).has('authorization'), false);
    const args = f.requests.at(-1).message.params.arguments;
    assert.equal(args.session_id, THREAD);
    assert.equal(args.model_name, MODEL.provider_endpoint);
    assert.equal(args.objective, 'Find current Node release facts');
    const model = f.modelCalls[0];
    assert.equal(model.webSearch, false);
    assert.ok(model.messages.at(-1).content.includes('Release facts from the web.'));
    assert.ok(!model.messages.filter(m => m.role === 'system').some(m => m.content.includes('Release facts from the web.')));
    assert.ok(text.includes('https://nodejs.org/en/blog/release'));
    const debit = f.calls.find(c => c.name === 'ledger_debit').args;
    assert.equal(debit.p_credits, 3);
    assert.equal(debit.p_inputs.search_provider, 'parallel');
    assert.equal('search_cost_usd' in debit.p_inputs, false, 'MCP usage is not a reported USD cost');
    const saved = f.calls.find(c => c.name === 'chat_complete_turn').args;
    assert.match(saved.p_reply, /Sources\n- \[Current release\]/);
});

test('disabled provider and missing explicit Exa key refuse before network or debit', async () => {
    for (const provider of ['off', 'invalid', 'exa']) {
        const f = fixture({ env: { CHAT_SEARCH_PROVIDER: provider } });
        assert.equal((await f.run()).status, 409);
        assert.equal(f.requests.length, 0);
        assert.ok(!f.calls.some(c => c.name === 'ledger_debit'));
    }
});

test('web off, plugin catalog choice and model gates preserve their existing paths', async () => {
    for (const options of [{ web: false }, { model: { chat_web_engine: 'plugin' } }, { model: { gated_flag: true } }, { model: { active: false } }]) {
        const f = fixture(options);
        const response = await f.run();
        await response.text();
        assert.equal(f.requests.length, 0);
        if (options.model?.chat_web_engine === 'plugin') assert.equal(f.modelCalls[0].webSearch, true);
    }
});

test('balance and supplier permission refusals stop before the anonymous search', async () => {
    for (const replies of [{ read_user_credits: { balance: 0 } }, { provider_spend_admit_model: { ok: false, code: 'PROVIDER_SPEND_LIMIT', scope: 'user_hour', retry_after_seconds: 60 } }]) {
        const f = fixture({ replies });
        assert.ok((await f.run()).status >= 400);
        assert.equal(f.requests.length, 0);
        assert.ok(!f.calls.some(c => c.name === 'ledger_debit'));
    }
});

test('a Parallel failure refuses before debit without calling Exa or model', async () => {
    const f = fixture({ env: { EXA_API_KEY: 'saved-exa', CHAT_SEARCH_PROVIDER: 'parallel' } });
    globalThis.fetch = async (url) => { assert.equal(String(url), 'https://search.parallel.ai/mcp'); return new Response('private upstream diagnostic', { status: 429 }); };
    const response = await f.run();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'search_rate_limited' });
    assert.equal(f.modelCalls.length, 0);
    assert.ok(!f.calls.some(c => c.name === 'ledger_debit'));
});

test('models endpoint agrees with resolver and still requires verified identity', async () => {
    process.env.SUPABASE_URL = 'https://db.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
    process.env.CHAT_ENABLED = 'true';
    delete process.env.EXA_API_KEY;
    globalThis.fetch = async (url) => Response.json(String(url).includes('model_catalog') ? [MODEL] : { ok: true });
    for (const [provider, available] of [['', true], ['parallel', true], ['exa', false], ['off', false], ['invalid', false]]) {
        process.env.CHAT_SEARCH_PROVIDER = provider;
        const req = new Request('https://veyrnox.ai/api/v1/chat/models', { headers: { 'x-veyrnox-auth-id': AUTH } });
        const data = await (await getModels(req)).json();
        assert.equal(Boolean(data.models[0].options.web), available, provider);
    }
    assert.equal((await getModels(new Request('https://veyrnox.ai/api/v1/chat/models'))).status, 401);
});
