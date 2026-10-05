/**
 * OpenRouter chat adapter (ADR-0067) — streaming completions, Web Crypto and fetch only.
 *
 * `provider_endpoint` of a text catalog row is the OpenRouter model slug, e.g. "vendor/model".
 * The target URL is a constant: nothing a user sends decides where the request goes.
 *
 * Configuration (read at the route layer): OPENROUTER_API_KEY, the same backend secret as video.
 *
 * Errors are typed codes, never the vendor's message: it can echo prompts or account details.
 */

export const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
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
 * @param {{apiKey:string, model:string, messages:{role:string,content:string}[], maxTokens:number,
 *          signal?:AbortSignal, fetchImpl?:typeof fetch}} args
 */
export async function* streamChat({ apiKey, model, messages, maxTokens, signal, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new ChatProviderError('provider_not_configured');
    if (typeof model !== 'string' || !SLUG_RE.test(model)) throw new ChatProviderError('provider_model_unmapped');
    let res;
    try {
        res = await fetchImpl(CHAT_COMPLETIONS_URL, {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
        });
    } catch (err) {
        if (signal && signal.aborted) throw err;
        throw new ChatProviderError('provider_unavailable');
    }
    if (!res.ok || !res.body) throw new ChatProviderError(codeFor(res.status));

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
                const text = json && json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
                if (typeof text === 'string' && text) yield { delta: text };
            }
        }
    } finally {
        try { await reader.cancel(); } catch { /* already closed */ }
    }
}
