/**
 * Chat (ADR-0067): limits, validation and prompt assembly. Pure, no I/O.
 *
 * A reply is a job priced per reply from model_catalog, so the two caps below are what make the flat
 * price safe: provider_cost_per_unit on a text row is the worst case at these caps (ADR-0014 floor).
 */

export const MAX_REPLY_TOKENS = 1024;
// A catalog row may raise its own cap (a model that reasons spends part of it thinking) and set a
// reasoning effort. The ceiling bounds the worst-case cost the row's price is checked against.
export const MIN_ROW_REPLY_TOKENS = 256;
export const MAX_ROW_REPLY_TOKENS = 8192;
export const REASONING_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high']);
export const MAX_HISTORY_CHARS = 24000;
export const MAX_USER_TEXT = 8000;
export const MAX_TITLE = 120;
export const MAX_SYSTEM_PROMPT = 4000;
// Same entry-point limit as generations: 10 jobs per 60 seconds, counted inside ledger_debit.
export const RATE_LIMIT_PER_WINDOW = 10;
export const RATE_WINDOW_SECONDS = 60;

export const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the exact string "true" turns Chat on. Read per request, never cached. */
/**
 * The reply cap and reasoning effort for a catalog row. Anything missing or out of range falls back
 * to the default cap and no reasoning setting, so a bad row can never send an odd value upstream.
 * @param {{chat_max_reply_tokens?:unknown, chat_reasoning_effort?:unknown}|null|undefined} row
 * @returns {{maxTokens:number, reasoningEffort:string|null}}
 */
export function replyBudget(row, options = {}) {
    const base = baseBudget(row);
    const t = thinkingOffer(row);
    return options && options.thinking === true && t ? { maxTokens: t.maxTokens, reasoningEffort: t.effort } : base;
}

function baseBudget(row) {
    const cap = row && row.chat_max_reply_tokens;
    const effort = row && row.chat_reasoning_effort;
    return {
        maxTokens: Number.isInteger(cap) && cap >= MIN_ROW_REPLY_TOKENS && cap <= MAX_ROW_REPLY_TOKENS ? cap : MAX_REPLY_TOKENS,
        reasoningEffort: typeof effort === 'string' && REASONING_EFFORTS.includes(effort) ? effort : null,
    };
}

const positiveInt = (n) => Number.isInteger(n) && n > 0;

/** The Thinking option, or null when the row does not offer it (all three columns must be valid). */
function thinkingOffer(row) {
    const effort = row && row.chat_thinking_effort;
    const cap = row && row.chat_thinking_max_reply_tokens;
    const extra = row && row.chat_thinking_extra_credits;
    if (typeof effort !== 'string' || !REASONING_EFFORTS.includes(effort)) return null;
    if (!Number.isInteger(cap) || cap < MIN_ROW_REPLY_TOKENS || cap > MAX_ROW_REPLY_TOKENS) return null;
    if (!positiveInt(extra)) return null;
    return { effort, maxTokens: cap, extraCredits: extra };
}

/** The Web search option, or null when the row does not offer it. */
function webOffer(row) {
    const extra = row && row.chat_web_extra_credits;
    return positiveInt(extra) ? { extraCredits: extra } : null;
}

/** What a row offers, for the models route: extra Credits per option, or null. */
export function rowOptions(row) {
    const t = thinkingOffer(row), w = webOffer(row);
    return { thinking: t ? { extra_credits: t.extraCredits } : null, web: w ? { extra_credits: w.extraCredits } : null };
}

/**
 * Credits for one reply: the catalog base plus the catalog extra for each option chosen. This looks prices
 * up and adds them; nothing is computed from cost or tokens here. An option the row does not offer is refused.
 */
export function replyPrice(row, options = {}) {
    const base = row && row.credits_5s;
    if (!positiveInt(base)) return { ok: false, error: 'model_unavailable' };
    let credits = base;
    if (options && options.thinking) {
        const t = thinkingOffer(row);
        if (!t) return { ok: false, error: 'option_unavailable' };
        credits += t.extraCredits;
    }
    if (options && options.web) {
        const w = webOffer(row);
        if (!w) return { ok: false, error: 'option_unavailable' };
        credits += w.extraCredits;
    }
    return { ok: true, credits };
}

const MAX_SOURCES = 8;

/**
 * The sources a web-searched reply used, as a short markdown list to append to the reply. Only http(s)
 * links, deduplicated, titles stripped of brackets and line breaks, at most eight. Empty when none.
 */
export function sourcesMarkdown(sources) {
    if (!Array.isArray(sources)) return '';
    const seen = new Set();
    const lines = [];
    for (const s of sources) {
        if (lines.length >= MAX_SOURCES) break;
        let u;
        try { u = new URL(s && s.url); } catch { continue; }
        if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || seen.has(u.href)) continue;
        seen.add(u.href);
        const title = String((s && s.title) || '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)
            || u.hostname.replace(/^www\./, '');
        lines.push(`- [${title}](${u.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`);
    }
    return lines.length ? `\n\nSources\n${lines.join('\n')}` : '';
}

export function chatEnabled(env) {
    return !!env && env.CHAT_ENABLED === 'true';
}

/** @returns {{ok:true, text:string, key:string}|{ok:false, error:string}} */
export function validateTurn(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > MAX_USER_TEXT) return { ok: false, error: 'invalid_text' };
    if (typeof body.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(body.idempotency_key)) {
        return { ok: false, error: 'idempotency_key_required' };
    }
    const options = parseOptions(body.options);
    if (!options) return { ok: false, error: 'invalid_options' };
    return { ok: true, text, key: body.idempotency_key, options };
}

/** `{thinking, web}`, both booleans, absent means off. Anything else is refused (null if invalid). */
function parseOptions(raw) {
    if (raw === undefined) return { thinking: false, web: false };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const [k, v] of Object.entries(raw)) if ((k !== 'thinking' && k !== 'web') || typeof v !== 'boolean') return null;
    return { thinking: raw.thinking === true, web: raw.web === true };
}

const PATCH_KEYS = new Set(['title', 'pinned', 'system_prompt', 'model_id']);

/**
 * A thread change. Unknown keys are refused rather than ignored, so a typo cannot look like success.
 * @returns {{ok:true, patch:object}|{ok:false, error:string}}
 */
export function validateThreadPatch(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' };
    const keys = Object.keys(body);
    if (keys.length === 0) return { ok: false, error: 'patch_empty' };
    for (const k of keys) if (!PATCH_KEYS.has(k)) return { ok: false, error: `patch_key_not_allowed:${k.slice(0, 32)}` };
    const patch = {};
    if ('title' in body) {
        const t = typeof body.title === 'string' ? body.title.trim() : '';
        if (!t || t.length > MAX_TITLE) return { ok: false, error: 'invalid_title' };
        patch.title = t;
    }
    if ('pinned' in body) {
        if (typeof body.pinned !== 'boolean') return { ok: false, error: 'invalid_pinned' };
        patch.pinned = body.pinned;
    }
    if ('system_prompt' in body) {
        if (typeof body.system_prompt !== 'string' || body.system_prompt.length > MAX_SYSTEM_PROMPT) {
            return { ok: false, error: 'invalid_system_prompt' };
        }
        patch.system_prompt = body.system_prompt;
    }
    if ('model_id' in body) {
        if (typeof body.model_id !== 'string' || !MODEL_ID_RE.test(body.model_id)) return { ok: false, error: 'invalid_model_id' };
        patch.model_id = body.model_id;
    }
    return { ok: true, patch };
}

/** The messages sent to the model: instructions, recent history, then this turn. */
export function buildMessages({ systemPrompt, history, text }) {
    const out = [];
    if (typeof systemPrompt === 'string' && systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt });
    for (const m of Array.isArray(history) ? history : []) {
        if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
            out.push({ role: m.role, content: m.content });
        }
    }
    out.push({ role: 'user', content: text });
    return out;
}

/** One server-sent event frame. */
export function sseFrame(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
