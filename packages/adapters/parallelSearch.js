/** A bounded, fetch-only Streamable HTTP MCP caller for capped Chat Web search.
 * Official MCP clients import jose, which is excluded from this Worker's SSR graph.
 * No subscriptions, OAuth, retries or automatic page fetching are needed here.
 */
import { cleanSearchResult, SEARCH_LIMITS, SearchError } from './exa.js';

export { SearchError } from './exa.js';
export const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';
export const PARALLEL_USER_AGENT = 'Veyrnox.ai/2.0.0 (+https://github.com/aljobson/Veyrnox.ai)';
const PROTOCOL = '2025-03-26';
const MAX_RESPONSE_BYTES = 256_000;

function httpError(status) {
    if (status === 401 || status === 403) return 'search_auth_failed';
    if (status === 402) return 'search_payment_required';
    if (status === 429) return 'search_rate_limited';
    return status >= 400 && status < 500 ? 'search_request_rejected' : 'search_unavailable';
}

/** Read one matching response, including SSE delivered in arbitrarily split chunks. */
async function readEnvelope(response, id, signal) {
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    if (!sse && !response.headers.get('content-type')?.includes('application/json')) throw new SearchError('search_unavailable');
    if (!response.body) throw new SearchError('search_unavailable');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, pending = '', endedCR = false;
    try {
        while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            bytes += value?.byteLength || 0;
            if (bytes > MAX_RESPONSE_BYTES) throw new SearchError('search_unavailable');
            let chunk = decoder.decode(value, { stream: !done });
            if (sse && chunk) {
                // SSE permits CR, LF and CRLF, including CRLF split across reads.
                if (endedCR && chunk.startsWith('\n')) chunk = chunk.slice(1);
                endedCR = chunk.endsWith('\r');
                chunk = chunk.replace(/\r\n?/g, '\n');
            }
            pending += chunk;
            if (sse) {
                let boundary;
                while ((boundary = /\n\n/.exec(pending))) {
                    const frame = pending.slice(0, boundary.index);
                    pending = pending.slice(boundary.index + boundary[0].length);
                    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
                    if (data) {
                        const message = JSON.parse(data);
                        if (message.id === id) return message;
                    }
                }
            }
            if (done) break;
        }
        if (!sse) return JSON.parse(pending);
        throw new SearchError('search_unavailable');
    } finally {
        // Stop an SSE stream as soon as the response arrives; do not await a remote close.
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** Same bounded result contract as Exa. The total deadline includes MCP discovery and body reads. */
export async function searchWeb({ query, sessionId, modelName, signal, timeoutMs = SEARCH_LIMITS.timeoutMs, fetchImpl = fetch }) {
    const q = typeof query === 'string' ? query.trim().slice(0, SEARCH_LIMITS.queryChars) : '';
    if (!q) throw new SearchError('search_request_rejected');
    signal?.throwIfAborted();
    const ac = new AbortController();
    const stop = () => ac.abort(signal.reason);
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => ac.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    let requestId = 0;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': PARALLEL_USER_AGENT };
    const post = async (method, params, notification = false) => {
        ac.signal.throwIfAborted();
        const id = ++requestId;
        const response = await fetchImpl(PARALLEL_MCP_URL, {
            method: 'POST', redirect: 'error', signal: ac.signal, headers: { ...headers },
            body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
        });
        if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            throw new SearchError(httpError(response.status));
        }
        if (notification) { void response.body?.cancel().catch(() => {}); return null; }
        const message = await readEnvelope(response, id, ac.signal);
        if (message?.jsonrpc !== '2.0' || message.id !== id || message.error || !message.result) throw new SearchError('search_unavailable');
        if (method === 'initialize') {
            const session = response.headers.get('mcp-session-id');
            if (session) headers['Mcp-Session-Id'] = session;
        }
        return message.result;
    };
    try {
        const initialized = await post('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'veyrnox-ai', version: '2.0.0' } });
        if (initialized.protocolVersion !== PROTOCOL || !initialized.capabilities?.tools) throw new SearchError('search_unavailable');
        headers['MCP-Protocol-Version'] = initialized.protocolVersion;
        await post('notifications/initialized', undefined, true);
        const discovery = await post('tools/list', {});
        const tool = discovery.tools?.find(t => t.name === 'web_search');
        if (tool?.inputSchema?.properties?.objective?.type !== 'string' || tool?.inputSchema?.properties?.search_queries?.type !== 'array') throw new SearchError('search_unavailable');
        const args = { objective: q, search_queries: [q] };
        if (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 100) args.session_id = sessionId;
        if (typeof modelName === 'string' && modelName.length > 0 && modelName.length <= 100) args.model_name = modelName;
        const result = await post('tools/call', { name: 'web_search', arguments: args });
        if (result.isError) {
            const limited = result.content?.some(c => c.type === 'text' && /rate.limit|quota.exceeded/i.test(c.text));
            throw new SearchError(limited ? 'search_rate_limited' : 'search_unavailable');
        }
        let payload = result.structuredContent;
        if (!payload) {
            const content = result.content?.find(c => c.type === 'text');
            payload = JSON.parse(content?.text || '');
        }
        if (!Array.isArray(payload?.results)) throw new SearchError('search_unavailable');
        const results = [];
        for (const row of payload.results) {
            const text = Array.isArray(row?.excerpts) ? row.excerpts.filter(x => typeof x === 'string').join('\n') : '';
            const cleaned = cleanSearchResult({ ...row, text });
            if (cleaned) results.push(cleaned);
            if (results.length === SEARCH_LIMITS.results) break;
        }
        return { results, costUsd: null };
    } catch (err) {
        if (signal?.aborted) throw signal.reason;
        if (ac.signal.aborted) throw new SearchError('search_timeout');
        if (err instanceof SearchError) throw err;
        throw new SearchError('search_unavailable');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
    }
}
