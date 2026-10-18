// Synthetic critical flow: real local Chat UI and real turn/search orchestration;
// database, model output and MCP HTTP are scripted. No provider or database writes.
import { test, expect, installProductFixtures, SYNTHETIC_USER } from './fixtures/authenticated-product.mjs';
import { runChatTurn } from '../lib/chatTurn.js';
import { rowOptions } from '../lib/chat.js';
import { resolveChatSearch } from '../lib/chatSearch.js';
import { PARALLEL_MCP_URL, PARALLEL_USER_AGENT } from '../packages/adapters/parallelSearch.js';

const THREAD = '00000000-0000-4000-8000-000000000067';
const JOB = '00000000-0000-4000-8000-000000000068';
const QUESTION = 'Which release is current in this synthetic example?';
const ANSWER = 'The synthetic release is version 22.';
const SOURCE = 'https://example.com/synthetic-release';
const MODEL = {
  id: 'synthetic-capped-chat', name: 'Synthetic capped chat', provider: 'openrouter-chat',
  provider_endpoint: 'synthetic/exact-model', modality: 'text', active: true,
  credits_5s: 2, chat_web_engine: 'capped', chat_web_extra_credits: 1,
};

async function installChat(page, { provider, limited = false } = {}) {
  // Deliberately omit EXA_API_KEY and every unrelated feature/credential flag.
  const env = { OPENROUTER_API_KEY: 'synthetic-model-key', ...(provider ? { CHAT_SEARCH_PROVIDER: provider } : {}) };
  const state = { thread: null, messages: [], calls: [], modelCalls: [], mcp: [], submitted: [], reads: 0, balance: 1000 };
  const configured = resolveChatSearch(env).provider !== 'off';
  const rpc = async (name, args) => {
    state.calls.push({ name, args });
    switch (name) {
      case 'check_generation_rate_limit': case 'provider_spend_admit_model': case 'job_submitted': return { ok: true };
      case 'chat_turn_context': return { ok: true, user_id: SYNTHETIC_USER.id, model_id: MODEL.id, system_prompt: '', history: [] };
      case 'chat_stops_before_text': return 0;
      case 'read_user_credits': return { balance: state.balance };
      case 'ledger_debit': state.balance -= args.p_credits; return { ok: true, job_id: JOB, balance_after: state.balance };
      case 'chat_complete_turn':
        state.messages = [
          { id: 'synthetic-user-message', role: 'user', content: args.p_user_text, status: 'complete', credits: 0 },
          { id: 'synthetic-assistant-message', role: 'assistant', content: args.p_reply, status: args.p_status, credits: 1000 - state.balance },
        ];
        return { ok: true, message_id: 'synthetic-assistant-message', refund: false };
      default: throw new Error(`Unscripted synthetic RPC: ${name}`);
    }
  };
  const mcpFetch = async (url, init) => {
    if (String(url) !== PARALLEL_MCP_URL) throw new Error('Synthetic chat refuses an external transport destination');
    const request = JSON.parse(init.body);
    state.mcp.push({ url: String(url), request, userAgent: new Headers(init.headers).get('user-agent') });
    if (limited) return new Response('Synthetic anonymous quota limit', { status: 429 });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'initialize'
      ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic-parallel', version: '1' } }
      : request.method === 'tools/list'
        ? { tools: [{ name: 'web_search', inputSchema: { type: 'object', properties: {
          objective: { type: 'string' }, search_queries: { type: 'array', items: { type: 'string' } },
        }, required: ['objective', 'search_queries'] } }] }
        : { structuredContent: { results: [
          { url: 'javascript:alert(1)', title: 'Unsafe source', excerpts: ['Discard this unsafe source'] },
          { url: SOURCE, title: 'Synthetic release source', excerpts: ['The current synthetic release is version 22.'] },
        ] } };
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  const fixture = await installProductFixtures(page, { routes: async ({ url, origin, method, body, json, route }) => {
    if (url.origin !== origin) return false;
    if (method === 'GET' && url.pathname === '/api/v1/chat/models') return json({
      models: [{ id: MODEL.id, name: MODEL.name, maker: 'other', maker_label: 'Other', credits_per_reply: MODEL.credits_5s,
        max_reply_tokens: 1024, gated: false, options: rowOptions(MODEL, { searchConfigured: configured }) }],
      max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048,
    });
    if (url.pathname === '/api/v1/chat/threads') {
      if (method === 'GET') return json({ threads: state.thread ? [state.thread] : [] });
      if (method === 'POST') {
        if (body.model_id !== MODEL.id) throw new Error('Synthetic chat only accepts its scripted model');
        state.thread = { id: THREAD, model_id: MODEL.id, title: 'Synthetic search conversation', system_prompt: '', pinned: false, folder_id: null };
        return json({ thread: state.thread });
      }
    }
    if (url.pathname === `/api/v1/chat/threads/${THREAD}`) {
      if (method === 'GET') { state.reads++; return json({ thread: state.thread, messages: state.messages }); }
      if (method === 'DELETE') { state.thread = null; return json({ ok: true }); }
    }
    if (url.pathname === `/api/v1/chat/threads/${THREAD}/messages` && method === 'POST') {
      state.submitted.push(body);
      const previousFetch = globalThis.fetch;
      try {
        // Keep the real resolver and adapter; script only the outgoing MCP HTTP boundary.
        globalThis.fetch = mcpFetch;
        const response = await runChatTurn({ authId: SYNTHETIC_USER.id, threadId: THREAD, body, cfg: {}, env, deps: {
          rpc, select: async () => [MODEL], stream: async function* (args) { state.modelCalls.push(args); yield { delta: ANSWER }; },
        } });
        const responseBody = await response.text();
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: responseBody });
        return true;
      } finally { globalThis.fetch = previousFetch; }
    }
    return false;
  } });
  return { fixture, state };
}

async function openChat(fixture, page) {
  expect((await fixture.open('/app/chat')).status()).toBe(200);
  await expect(page.getByRole('combobox', { name: 'Model for next reply', exact: true })).toHaveValue(MODEL.id);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
}
async function sendQuestion(page, price) {
  await page.getByLabel('Message', { exact: true }).fill(QUESTION);
  await page.getByRole('button', { name: `Send · ${price} Credits`, exact: true }).click();
}
async function reopenStoredChat(page) {
  await page.reload();
  const drawer = page.getByRole('button', { name: 'Chats', exact: true });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole('button', { name: 'Synthetic search conversation', exact: true }).click();
}

test('synthetic no-key Web search reaches the real MCP dispatcher and persists safe sources in Chat', async ({ page }) => {
  const { fixture, state } = await installChat(page);
  await openChat(fixture, page);
  const web = page.getByRole('button', { name: /Web \+1/ });
  await expect(web).toHaveAttribute('aria-pressed', 'false');
  await web.click();
  await expect(web).toHaveAttribute('aria-pressed', 'true');
  await sendQuestion(page, 3);
  const reply = page.getByRole('article', { name: 'Assistant', exact: true });
  await expect(reply).toContainText(ANSWER);
  await expect(reply.getByRole('link', { name: 'Synthetic release source', exact: true })).toHaveAttribute('href', SOURCE);
  await expect(reply).not.toContainText('Unsafe source');
  await expect(page.getByRole('button', { name: 'Copy reply', exact: true })).toBeVisible();
  expect(state.submitted).toHaveLength(1);
  expect(state.submitted[0].options.web).toBe(true);
  expect(state.mcp.map(row => row.request.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  expect(state.mcp.every(row => row.userAgent === PARALLEL_USER_AGENT)).toBe(true);
  expect(state.mcp.at(-1).request.params.arguments).toMatchObject({ session_id: THREAD, model_name: MODEL.provider_endpoint });
  expect(state.modelCalls).toHaveLength(1);
  expect(state.modelCalls[0].webSearch).toBe(false);
  expect(JSON.stringify(state.modelCalls[0].messages)).toContain('The current synthetic release is version 22.');
  expect(JSON.stringify(state.modelCalls[0].messages)).not.toContain('javascript:');
  expect(state.calls.filter(row => row.name === 'ledger_debit')).toHaveLength(1);
  expect(state.calls.filter(row => row.name === 'chat_complete_turn')).toHaveLength(1);
  expect(state.messages[1].content).toContain(SOURCE);
  expect(state.balance).toBe(997);
  await reopenStoredChat(page);
  await expect(page.getByRole('article', { name: 'Assistant', exact: true }).getByRole('link', { name: 'Synthetic release source', exact: true })).toHaveAttribute('href', SOURCE);
  expect(state.reads).toBeGreaterThan(1);
});

test('synthetic explicit off hides capped Web search and a plain Chat reply makes no MCP request', async ({ page }) => {
  const { fixture, state } = await installChat(page, { provider: 'off' });
  await openChat(fixture, page);
  await expect(page.getByRole('button', { name: /Web \+1/ })).toHaveCount(0);
  await sendQuestion(page, 2);
  await expect(page.getByRole('article', { name: 'Assistant', exact: true })).toContainText(ANSWER);
  await expect(page.getByRole('button', { name: 'Copy reply', exact: true })).toBeVisible();
  expect(state.submitted[0].options.web).toBe(false);
  expect(state.mcp).toHaveLength(0);
  expect(state.calls.filter(row => row.name === 'ledger_debit')).toHaveLength(1);
  expect(state.balance).toBe(998);
});

test('synthetic anonymous quota refusal shows the existing no-charge Web warning', async ({ page }) => {
  const { fixture, state } = await installChat(page, { limited: true });
  await openChat(fixture, page);
  await page.getByRole('button', { name: /Web \+1/ }).click();
  await sendQuestion(page, 3);
  await expect(page.getByRole('alert')).toContainText('Web search is busy. Try again in a moment. No Credits were used.');
  expect(state.mcp).toHaveLength(1);
  expect(state.modelCalls).toHaveLength(0);
  expect(state.calls.filter(row => row.name === 'ledger_debit')).toHaveLength(0);
  expect(state.messages).toHaveLength(0);
  expect(state.balance).toBe(1000);
});
