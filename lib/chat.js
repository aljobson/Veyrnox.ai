/**
 * Chat (ADR-0067): limits, validation and prompt assembly. Pure, no I/O.
 *
 * A reply is a job priced per reply from model_catalog, so the two caps below are what make the flat
 * price safe: provider_cost_per_unit on a text row is the worst case at these caps (ADR-0014 floor).
 */

export const MAX_REPLY_TOKENS = 1024;
// Said to every model, ahead of the user's own instructions. The reply screen shows plain text and markdown, not
// typeset maths, so notation written in LaTeX would appear as raw symbols. About 20 tokens, inside the price margin.
export const PLATFORM_INSTRUCTION = 'Write mathematics in plain text. Do not use LaTeX or dollar-sign delimiters.';
// A catalog row may raise its own cap (a model that reasons spends part of it thinking) and set a
// reasoning effort. The ceiling bounds the worst-case cost the row's price is checked against.
export const MIN_ROW_REPLY_TOKENS = 256;
export const MAX_ROW_REPLY_TOKENS = 8192;
// Image attachments (ADR-0068). The long edge is capped because image cost follows pixel size: a 4,096 px
// picture cost one provider 19,674 input tokens against 4,929 at 2,048 px.
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_EDGE = 2048;
const SOURCE_KEY_MAX = 200;
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

/** The Images option (image attachments), or null when the row does not offer it. */
function imagesOffer(row) {
    const extra = row && row.chat_images_extra_credits;
    return positiveInt(extra) ? { extraCredits: extra } : null;
}

/**
 * The Deep research option (ADR-0070), or null when the row does not offer it. All three columns must be valid, and the
 * write cap is in the same range every reply cap is held to.
 */
function researchOffer(row) {
    const extra = row && row.chat_research_extra_credits;
    const cap = row && row.chat_research_write_max_tokens;
    if (!positiveInt(extra) || !Number.isInteger(cap) || cap < MIN_ROW_REPLY_TOKENS || cap > MAX_ROW_REPLY_TOKENS) return null;
    return { extraCredits: extra, writeMaxTokens: cap };
}

/** The one switch for Deep research. Off (the default) means no research column is read and no research run can start. */
export function researchEnabled(env) {
    return !!env && env.CHAT_RESEARCH_ENABLED === 'true';
}

/** The row's research settings for the turn, or null. Exported so the turn reads the same validated offer the price used. */
export function researchSettings(row) {
    return researchOffer(row);
}

/** What a row offers, for the models route: extra Credits per option, or null. `research` appears only when offered. */
export function rowOptions(row) {
    const t = thinkingOffer(row), w = webOffer(row), i = imagesOffer(row), r = researchOffer(row);
    return {
        thinking: t ? { extra_credits: t.extraCredits } : null,
        web: w ? { extra_credits: w.extraCredits } : null,
        images: i ? { extra_credits: i.extraCredits } : null,
        ...(r ? { research: { extra_credits: r.extraCredits } } : {}),
    };
}

/**
 * Credits for one reply: the catalog base plus the catalog extra for each option chosen. This looks prices
 * up and adds them; nothing is computed from cost or tokens here. An option the row does not offer is refused.
 */
export function replyPrice(row, options = {}) {
    const base = row && row.credits_5s;
    if (!positiveInt(base)) return { ok: false, error: 'model_unavailable' };
    let credits = base;
    if (options && options.research) {
        // A research run already includes its own searching and writing, so it is priced alone: never together with
        // another option, and only on a row that offers it.
        const r = researchOffer(row);
        if (!r || options.thinking || options.web || options.images) return { ok: false, error: 'option_unavailable' };
        return { ok: true, credits: base + r.extraCredits };
    }
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
    if (options && options.images) {
        const i = imagesOffer(row);
        if (!i) return { ok: false, error: 'option_unavailable' };
        credits += i.extraCredits;
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

/**
 * The OpenRouter key chat spends from. A dedicated `OPENROUTER_CHAT_API_KEY` always wins, so chat can have its own
 * spend cap. In production it is required: with only the shared video key chat is "not configured", so switching the
 * flag on can never quietly spend that key. Staging and local development keep falling back to the shared key.
 * @param {Record<string, string|undefined>} env
 * @returns {string} the key, or '' when chat is not configured
 */
export function chatApiKey(env) {
    const own = env && env.OPENROUTER_CHAT_API_KEY;
    if (typeof own === 'string' && own) return own;
    if (env && env.APP_ENV === 'production') return '';
    const shared = env && env.OPENROUTER_API_KEY;
    return typeof shared === 'string' ? shared : '';
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
    const attachments = parseAttachments(body.attachments);
    if (!attachments) return { ok: false, error: 'invalid_attachments' };
    return { ok: true, text, key: body.idempotency_key, options, attachments };
}

/**
 * Up to four distinct upload keys, as `[{ source_key }]`; absent means none. Returns the keys, or null when
 * malformed. Whether a key is the caller's, and is really an image, is checked later against R2.
 */
function parseAttachments(raw) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
    const keys = [];
    for (const a of raw) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
        const names = Object.keys(a);
        if (names.length !== 1 || names[0] !== 'source_key') return null;
        const k = a.source_key;
        if (typeof k !== 'string' || !k || k.length > SOURCE_KEY_MAX || keys.includes(k)) return null;
        keys.push(k);
    }
    return keys;
}

/**
 * `{thinking, web}` and, for Deep research, `research`: all booleans, absent means off. Anything else is refused (null if
 * invalid). `research` is present in the result only when it is on, so a turn without it keeps exactly the shape it always had.
 */
function parseOptions(raw) {
    if (raw === undefined) return { thinking: false, web: false };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const [k, v] of Object.entries(raw)) if ((k !== 'thinking' && k !== 'web' && k !== 'research') || typeof v !== 'boolean') return null;
    return { thinking: raw.thinking === true, web: raw.web === true, ...(raw.research === true ? { research: true } : {}) };
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
export function buildMessages({ systemPrompt, history, text, images = [] }) {
    const out = [];
    // One system message, because not every provider accepts several: the platform line, then the user's own text.
    const own = typeof systemPrompt === 'string' && systemPrompt.trim() ? systemPrompt : '';
    out.push({ role: 'system', content: own ? `${PLATFORM_INSTRUCTION}\n\n${own}` : PLATFORM_INSTRUCTION });
    for (const m of Array.isArray(history) ? history : []) {
        if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
            out.push({ role: m.role, content: m.content });
        }
    }
    // Images ride on the last user message only, as content parts after the text; history stays plain text.
    out.push({
        role: 'user',
        content: Array.isArray(images) && images.length
            ? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
            : text,
    });
    return out;
}

/** One server-sent event frame. */
export function sseFrame(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
