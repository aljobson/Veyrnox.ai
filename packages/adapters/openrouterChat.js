/**
 * OpenRouter chat adapter (ADR-0067) — streaming completions, Web Crypto and fetch only.
 *
 * `provider_endpoint` of a text catalog row is the OpenRouter model slug, e.g. "vendor/model".
 * The target URL is a constant: nothing a user sends decides where the request goes.
 *
 * Configuration (read at the route layer, lib/chat.js chatApiKey): OPENROUTER_CHAT_API_KEY, a key of its own so chat
 * can have a spend cap. Staging and local development fall back to OPENROUTER_API_KEY, the video key; production does not.
 *
 * Errors are typed codes, never the vendor's message: it can echo prompts or account details.
 */

export const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const WEB_MAX_RESULTS = 3;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high']);
const SLUG_RE = /^[a-z0-9][a-z0-9._:/-]{0,100}$/i;

export class ChatProviderError extends Error {
    /** @param {string} code snake_case, safe to show a user and to store on a job */
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function codeFor(status) {
    if (status === 402) return 'provider_payment_required';
    if (status === 401 || status === 403) return 'provider_auth_failed';
    if (status === 404) return 'provider_model_unavailable';
    if (status === 408 || status === 504) return 'provider_timeout';
    if (status === 429) return 'provider_rate_limited';
    if (status === 400 || status === 422) return 'provider_request_rejected';
    return 'provider_unavailable';
}

/**
 * Stream a reply. Yields `{ delta: string }` for each piece of text.
 * Throws ChatProviderError if the provider refuses, drops, or reports an error mid-stream.
 *
 * @param {{apiKey:string, model:string, messages:{role:string,content:string}[], maxTokens:number, reasoningEffort?:string|null, webSearch?:boolean,
 *          signal?:AbortSignal, fetchImpl?:typeof fetch}} args
 */
export async function* streamChat({ apiKey, model, messages, maxTokens, reasoningEffort = null, webSearch = false, signal, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new ChatProviderError('provider_not_configured');
    if (typeof model !== 'string' || !SLUG_RE.test(model)) throw new ChatProviderError('provider_model_unmapped');
    let res;
    try {
        res = await fetchImpl(CHAT_COMPLETIONS_URL, {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            // Reasoning comes back in separate delta fields and is never read here: only `content` is yielded.
            body: JSON.stringify({
                model, messages, max_tokens: maxTokens, stream: true,
                // Route only to providers that do not store or train on the prompt. All ten catalog models answer under
                // this setting (checked live 2026-10-05); a model with no such provider would fail and be refunded.
                provider: { data_collection: 'deny' },
                ...(typeof reasoningEffort === 'string' && EFFORTS.has(reasoningEffort) ? { reasoning: { effort: reasoningEffort } } : {}),
                // Web search is OpenRouter's web plugin with a fixed result count; the price of it is the row's.
                ...(webSearch === true ? { plugins: [{ id: 'web', max_results: WEB_MAX_RESULTS }] } : {}),
            }),
        });
    } catch (err) {
        if (signal && signal.aborted) throw err;
        throw new ChatProviderError('provider_unavailable');
    }
    if (!res.ok || !res.body) throw new ChatProviderError(codeFor(res.status));

    const cited = new Set();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
        for (;;) {
            let chunk;
            try {
                chunk = await reader.read();
            } catch (err) {
                if (signal && signal.aborted) throw err;
                throw new ChatProviderError('provider_dropped');
            }
            if (chunk.done) return;
            buf += dec.decode(chunk.value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (!line.startsWith('data:')) continue;           // comments and keep-alives
                const data = line.slice(5).trim();
                if (data === '[DONE]') return;
                let json;
                try { json = JSON.parse(data); } catch { continue; } // a partial frame
                if (json && json.error) throw new ChatProviderError('provider_error');
                const delta = json && json.choices && json.choices[0] && json.choices[0].delta;
                const text = delta && delta.content;
                if (typeof text === 'string' && text) yield { delta: text };
                // Citations from web search arrive as annotations; each page is reported once.
                if (delta && Array.isArray(delta.annotations)) {
                    for (const a of delta.annotations) {
                        const c = a && a.type === 'url_citation' && a.url_citation;
                        if (c && typeof c.url === 'string' && !cited.has(c.url)) {
                            cited.add(c.url);
                            yield { source: { url: c.url, title: typeof c.title === 'string' ? c.title : '' } };
                        }
                    }
                }
            }
        }
    } finally {
        try { await reader.cancel(); } catch { /* already closed */ }
    }
}

/**
 * One reply, not streamed (Deep research's plan and search steps, ADR-0070). Same target, same privacy setting and the same
 * typed errors as streamChat. Returns the reply text and the pages a web search cited, each page once.
 *
 * @param {{apiKey:string, model:string, messages:{role:string,content:string}[], maxTokens:number, reasoningEffort?:string|null,
 *          webSearch?:boolean, signal?:AbortSignal, fetchImpl?:typeof fetch}} args
 * @returns {Promise<{text:string, sources:{url:string,title:string}[]}>}
 */
export async function completeChat({ apiKey, model, messages, maxTokens, reasoningEffort = null, webSearch = false, signal, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new ChatProviderError('provider_not_configured');
    if (typeof model !== 'string' || !SLUG_RE.test(model)) throw new ChatProviderError('provider_model_unmapped');
    let res;
    try {
        res = await fetchImpl(CHAT_COMPLETIONS_URL, {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, messages, max_tokens: maxTokens, stream: false,
                provider: { data_collection: 'deny' },
                ...(typeof reasoningEffort === 'string' && EFFORTS.has(reasoningEffort) ? { reasoning: { effort: reasoningEffort } } : {}),
                ...(webSearch === true ? { plugins: [{ id: 'web', max_results: WEB_MAX_RESULTS }] } : {}),
            }),
        });
    } catch (err) {
        if (signal && signal.aborted) throw err;
        throw new ChatProviderError('provider_unavailable');
    }
    if (!res.ok) throw new ChatProviderError(codeFor(res.status));
    let json;
    try { json = await res.json(); } catch { throw new ChatProviderError('provider_dropped'); }
    if (json && json.error) throw new ChatProviderError('provider_error');
    const message = json && json.choices && json.choices[0] && json.choices[0].message;
    const text = message && typeof message.content === 'string' ? message.content : '';
    const sources = [];
    const seen = new Set();
    for (const a of (message && Array.isArray(message.annotations) ? message.annotations : [])) {
        const c = a && a.type === 'url_citation' && a.url_citation;
        if (c && typeof c.url === 'string' && !seen.has(c.url)) {
            seen.add(c.url);
            sources.push({ url: c.url, title: typeof c.title === 'string' ? c.title : '' });
        }
    }
    return { text, sources };
}
