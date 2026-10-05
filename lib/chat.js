/**
 * Chat (ADR-0067): limits, validation and prompt assembly. Pure, no I/O.
 *
 * A reply is a job priced per reply from model_catalog, so the two caps below are what make the flat
 * price safe: provider_cost_per_unit on a text row is the worst case at these caps (ADR-0014 floor).
 */

export const MAX_REPLY_TOKENS = 1024;
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
    return { ok: true, text, key: body.idempotency_key };
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
