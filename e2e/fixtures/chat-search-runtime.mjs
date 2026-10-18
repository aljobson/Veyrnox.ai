// Native Node fixture keeps the actual runtime ESM graph outside Playwright's transform loader.
// Every database/model operation is scripted and all HTTP is intercepted at one fixed MCP URL.
import { runChatTurn } from '../../lib/chatTurn.js';
import { rowOptions } from '../../lib/chat.js';
import { resolveChatSearch } from '../../lib/chatSearch.js';
import { PARALLEL_MCP_URL, PARALLEL_USER_AGENT } from '../../packages/adapters/parallelSearch.js';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 64000) throw new Error('Synthetic runtime input exceeds fixture limit');
}
const { env, model, authId, threadId, jobId, body, limited, answer, source } = JSON.parse(input);
const options = rowOptions(model, { searchConfigured: resolveChatSearch(env).provider !== 'off' });
if (!body) {
  process.stdout.write(JSON.stringify({ options, userAgent: PARALLEL_USER_AGENT }));
} else {
  const state = { messages: [], calls: [], modelCalls: [], mcp: [], balance: 1000 };
  const rpc = async (name, args) => {
    state.calls.push({ name, args });
    switch (name) {
      case 'check_generation_rate_limit': case 'provider_spend_admit_model': case 'job_submitted': return { ok: true };
      case 'chat_turn_context': return { ok: true, user_id: authId, model_id: model.id, system_prompt: '', history: [] };
      case 'chat_stops_before_text': return 0;
      case 'read_user_credits': return { balance: state.balance };
      case 'ledger_debit': state.balance -= args.p_credits; return { ok: true, job_id: jobId, balance_after: state.balance };
      case 'chat_complete_turn':
        state.messages = [
          { id: 'synthetic-user-message', role: 'user', content: args.p_user_text, status: 'complete', credits: 0 },
          { id: 'synthetic-assistant-message', role: 'assistant', content: args.p_reply, status: args.p_status, credits: 1000 - state.balance },
        ];
        return { ok: true, message_id: 'synthetic-assistant-message', refund: false };
      default: throw new Error(`Unscripted synthetic RPC: ${name}`);
    }
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url) !== PARALLEL_MCP_URL) throw new Error('Synthetic chat refuses an external transport destination');
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
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
            { url: source, title: 'Synthetic release source', excerpts: ['The current synthetic release is version 22.'] },
          ] } };
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    };
    const response = await runChatTurn({ authId, threadId, body, cfg: {}, env, deps: {
      rpc, select: async () => [model], stream: async function* (args) { state.modelCalls.push(args); yield { delta: answer }; },
    } });
    const responseBody = await response.text();
    process.stdout.write(JSON.stringify({ state, status: response.status, headers: Object.fromEntries(response.headers), body: responseBody }));
  } finally { globalThis.fetch = originalFetch; }
}
