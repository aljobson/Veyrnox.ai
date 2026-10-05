/**
 * Capped web search (ADR-0067 amendment 8) — one call to Exa, fetch only, no dependency.
 *
 * The point of owning this call is the limit: OpenRouter's web plugin injects page text of any length, so a search could not be
 * priced honestly. Here every result is asked for at a fixed length (`contents.text.maxCharacters`) and cut again on our side,
 * at most three results come back, and the query is cut too. What the model reads, and so what it costs, has a real ceiling.
 *
 * The target URL is a constant: nothing a user sends decides where the request goes. Results are untrusted text from the
 * internet. Only http and https links without credentials are kept. Errors are typed codes, never the vendor's message: it can
 * echo the query or account details.
 */

export const EXA_SEARCH_URL = 'https://api.exa.ai/search';
export const SEARCH_LIMITS = { results: 3, charsPerResult: 2000, queryChars: 300, titleChars: 200, timeoutMs: 8000 };
const MAX_URL_CHARS = 2000;

export class SearchError extends Error {
    /** @param {string} code snake_case, safe to show a user and to store */
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function codeFor(status) {
    if (status === 401 || status === 403) return 'search_auth_failed';
    if (status === 402) return 'search_payment_required';
    if (status === 429) return 'search_rate_limited';
    if (status >= 400 && status < 500) return 'search_request_rejected';
    return 'search_unavailable';
}

/** A usable result, or null: an http(s) link with no credentials, and some text. Cut to the limits. */
function clean(item) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || typeof item.text !== 'string') return null;
    let u;
    try { u = new URL(item.url); } catch { return null; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.href.length > MAX_URL_CHARS) return null;
    const text = item.text.trim().slice(0, SEARCH_LIMITS.charsPerResult);
    if (!text) return null;
    return { title: typeof item.title === 'string' ? item.title.trim().slice(0, SEARCH_LIMITS.titleChars) : '', url: u.href, text };
}

/**
 * @param {{apiKey:string, query:string, signal?:AbortSignal, timeoutMs?:number, fetchImpl?:typeof fetch}} args
 * @returns {Promise<{results:{title:string,url:string,text:string}[], costUsd:number|null}>} costUsd is the provider's own figure for this request
 * @throws {SearchError} typed; a caller's abort is rethrown as it was
 */
export async function searchWeb({ apiKey, query, signal, timeoutMs = SEARCH_LIMITS.timeoutMs, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new SearchError('search_not_configured');
    const q = typeof query === 'string' ? query.trim().slice(0, SEARCH_LIMITS.queryChars) : '';
    if (!q) throw new SearchError('search_request_rejected');

    const ac = new AbortController();
    const onAbort = () => ac.abort(signal.reason);
    if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ac.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    try {
        let res;
        try {
            res = await fetchImpl(EXA_SEARCH_URL, {
                method: 'POST',
                signal: ac.signal,
                headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q, numResults: SEARCH_LIMITS.results, type: 'auto', contents: { text: { maxCharacters: SEARCH_LIMITS.charsPerResult } } }),
            });
        } catch (err) {
            if (signal && signal.aborted) throw err;
            if (ac.signal.reason && ac.signal.reason.name === 'TimeoutError') throw new SearchError('search_timeout');
            throw new SearchError('search_unavailable');
        }
        if (!res.ok) throw new SearchError(codeFor(res.status));
        let json;
        try { json = await res.json(); } catch (err) {
            if (signal && signal.aborted) throw err;
            throw new SearchError(ac.signal.reason && ac.signal.reason.name === 'TimeoutError' ? 'search_timeout' : 'search_unavailable');
        }
        const rows = json && Array.isArray(json.results) ? json.results : [];
        const results = [];
        for (const row of rows) {
            const r = clean(row);
            if (r) results.push(r);
            if (results.length >= SEARCH_LIMITS.results) break;
        }
        const total = json && json.costDollars && json.costDollars.total;
        return { results, costUsd: Number.isFinite(total) && total >= 0 ? total : null };
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}
