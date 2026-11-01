/**
 * Pure helpers for scripts/probe-aeo-citations.mjs: read an answer and its
 * cited addresses out of each engine's response, and total a run. No network,
 * so every shape is covered by tests/aeoCitations.test.mjs.
 */
export const OWN_HOST = 'veyrnox.ai';
const BRAND = /veyrnox/i;

/** Lowercase host without "www.", or null when the text is not an http(s) address. */
export function hostOf(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch { return null; }
}

const unique = (list) => [...new Set(list.filter((x) => typeof x === 'string' && x))];

/** { text, urls } from Perplexity's chat completion. */
export function fromPerplexity(json) {
    const text = json?.choices?.[0]?.message?.content ?? '';
    const results = Array.isArray(json?.search_results) ? json.search_results.map((r) => r?.url) : [];
    return { text, urls: unique([...(Array.isArray(json?.citations) ? json.citations : []), ...results]) };
}

/** { text, urls } from an OpenAI Responses call with the web search tool. */
export function fromOpenAI(json) {
    const parts = (Array.isArray(json?.output) ? json.output : [])
        .filter((item) => item?.type === 'message')
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []));
    const text = parts.map((p) => p?.text ?? '').join('\n').trim();
    const urls = parts.flatMap((p) => (Array.isArray(p?.annotations) ? p.annotations : []))
        .filter((a) => a?.type === 'url_citation').map((a) => a.url);
    return { text, urls: unique(urls) };
}

/** { text, urls } from an Anthropic Messages call with the web search tool. */
export function fromAnthropic(json) {
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('').trim();
    const cited = blocks.filter((b) => b?.type === 'text').flatMap((b) => (Array.isArray(b.citations) ? b.citations : [])).map((c) => c?.url);
    const searched = blocks.filter((b) => b?.type === 'web_search_tool_result')
        .flatMap((b) => (Array.isArray(b.content) ? b.content : [])).map((r) => r?.url);
    return { text, urls: unique([...cited, ...searched]), cited: unique(cited) };
}

export const EXTRACTORS = { perplexity: fromPerplexity, openai: fromOpenAI, anthropic: fromAnthropic };

/** What one answer says about us: named in the text, linked, and who else is linked. */
export function score({ text, urls }) {
    const hosts = unique(urls.map(hostOf));
    return {
        mentioned: BRAND.test(text),
        cited: hosts.includes(OWN_HOST),
        ownUrls: urls.filter((u) => hostOf(u) === OWN_HOST),
        otherHosts: hosts.filter((h) => h !== OWN_HOST),
    };
}

/** Per engine and kind: how many answers named or cited us, and the most cited other hosts. */
export function summarise(rows) {
    const out = {};
    for (const row of rows) {
        if (row.error) continue;
        const bucket = (out[row.engine] ??= {});
        const b = (bucket[row.kind] ??= { answers: 0, mentioned: 0, cited: 0, hosts: {} });
        b.answers += 1;
        if (row.score.mentioned) b.mentioned += 1;
        if (row.score.cited) b.cited += 1;
        for (const h of row.score.otherHosts) b.hosts[h] = (b.hosts[h] ?? 0) + 1;
    }
    for (const bucket of Object.values(out)) {
        for (const b of Object.values(bucket)) {
            b.topHosts = Object.entries(b.hosts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 8);
            delete b.hosts;
        }
    }
    return out;
}
