/**
 * One chat turn (ADR-0067): check, debit, stream, then finish or refund.
 *
 *   1. rate check, then chat_turn_context (who owns the thread, which model, the history)
 *   2. the model must be an active text row of provider openrouter-chat; its Credits per reply is the price
 *   3. ledger_debit creates the job (kind 'chat'); job_submitted moves it to SUBMITTED
 *   4. stream the reply to the browser as server-sent events
 *   5. finish, exactly one of:
 *        text produced, stream complete or user stopped -> chat_complete_turn, job STORED, charged
 *        text produced, provider cut off                -> chat_complete_turn 'error', then ledger_refund
 *        nothing produced (any reason)                  -> job_failed, then ledger_refund, nothing stored
 *
 * If the isolate is cut after a disconnect, the job stays SUBMITTED and sweep_stuck_jobs refunds it after
 * 120 minutes: the safe direction for the user. Every dependency is injected so the money paths are tested
 * with fakes.
 */

import { rpc as realRpc, select as realSelect } from '../packages/db/supabase-client.js';
import { streamChat as realStream, ChatProviderError } from '../packages/adapters/openrouterChat.js';
import {
    MAX_HISTORY_CHARS, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_SECONDS,
    buildMessages, replyBudget, replyPrice, sourcesMarkdown, sseFrame, validateTurn, MODEL_ID_RE, UUID_RE,
} from './chat.js';

const PROVIDER = 'openrouter-chat';
const PROVIDER_TIMEOUT_MS = 90_000;
const MAX_STORED_REPLY = 32000; // chat_messages.content limit (migration 0193)
const ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

function limited(r) {
    const retry = Math.max(1, Math.min(600, Number(r.retry_after_seconds) || RATE_WINDOW_SECONDS));
    return json({ error: 'rate_limited', limit: r.limit, count: r.count, retry_after_seconds: retry }, 429, { 'Retry-After': String(retry) });
}

/**
 * @param {{authId:string, threadId:string, body:unknown, signal?:AbortSignal, cfg:object,
 *          env?:Record<string,string|undefined>,
 *          deps?:{rpc?:Function, select?:Function, stream?:Function}}} args
 * @returns {Promise<Response>} JSON for a refusal, text/event-stream for a started turn
 */
export async function runChatTurn({ authId, threadId, body, signal, cfg, env = process.env, deps = {} }) {
    const rpc = deps.rpc || realRpc;
    const select = deps.select || realSelect;
    const stream = deps.stream || realStream;

    if (!UUID_RE.test(threadId || '')) return json({ error: 'thread_not_found' }, 404);
    const turn = validateTurn(body);
    if (!turn.ok) return json({ error: turn.error }, 400);
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return json({ error: 'gateway_not_configured' }, 503);

    // Cheap early 429, before anything else is read. Fails closed, like generations.
    try {
        const rl = await rpc('check_generation_rate_limit', {
            p_auth_id: authId, p_limit_per_window: RATE_LIMIT_PER_WINDOW, p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
        if (!rl || typeof rl.ok !== 'boolean') return json({ error: 'rate_check_unavailable' }, 503);
        if (rl.ok === false) {
            if (rl.code === 'RATE_LIMITED') return limited(rl);
            if (rl.code === 'USER_NOT_FOUND') return json({ error: 'user_not_provisioned' }, 409);
            return json({ error: rl.code ? String(rl.code).toLowerCase() : 'rate_check_failed' }, 400);
        }
    } catch (err) {
        console.error('[chat] rate check errored:', err && err.message);
        return json({ error: 'rate_check_unavailable' }, 503);
    }

    let ctx;
    try {
        ctx = await rpc('chat_turn_context', { p_auth_id: authId, p_thread_id: threadId, p_history_chars: MAX_HISTORY_CHARS }, cfg);
    } catch (err) {
        console.error('[chat] context failed:', err && err.message);
        return json({ error: 'context_failed' }, 502);
    }
    if (!ctx || ctx.ok !== true) return json({ error: 'thread_not_found' }, 404);

    let model;
    try {
        if (!MODEL_ID_RE.test(ctx.model_id || '')) return json({ error: 'model_unavailable' }, 409);
        const rows = await select('model_catalog', {
            columns: 'id,provider,provider_endpoint,modality,credits_5s,gated_flag,active,chat_max_reply_tokens,chat_reasoning_effort,'
                + 'chat_thinking_effort,chat_thinking_max_reply_tokens,chat_thinking_extra_credits,chat_web_extra_credits',
            filter: `id=eq.${encodeURIComponent(ctx.model_id)}`,
        }, cfg);
        model = Array.isArray(rows) && rows[0];
    } catch (err) {
        console.error('[chat] catalog lookup failed:', err && err.message);
        return json({ error: 'catalog_lookup_failed' }, 502);
    }
    if (!model || !model.active || model.modality !== 'text' || model.provider !== PROVIDER) return json({ error: 'model_unavailable' }, 409);
    if (model.gated_flag) return json({ error: 'model_gated' }, 402);
    const price = replyPrice(model, turn.options);
    if (!price.ok) return json({ error: price.error }, 409);
    const credits = price.credits;
    const budget = replyBudget(model, turn.options);

    let debit;
    try {
        debit = await rpc('ledger_debit', {
            p_user_id: ctx.user_id,
            p_idempotency_key: turn.key,
            p_credits: credits,
            p_reason: 'debit:chat',
            p_model_id: model.id,
            // The job row never holds message text: that lives in chat_messages.
            p_inputs: { kind: 'chat', thread_id: threadId, options: turn.options },
            p_limit_per_window: RATE_LIMIT_PER_WINDOW,
            p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
    } catch (err) {
        console.error('[chat] ledger_debit failed:', err && err.message);
        return json({ error: 'debit_failed' }, 502);
    }
    if (debit && debit.ok === false && debit.code === 'RATE_LIMITED') return limited(debit);
    if (!debit || debit.ok === false) {
        const status = debit && debit.code === 'INSUFFICIENT_BALANCE' ? 402 : debit && debit.code === 'ACCOUNT_FROZEN' ? 403 : 400;
        if (debit && debit.message) console.error('[chat] debit rejected:', debit.code, debit.message);
        return json({ error: debit && debit.code ? String(debit.code).toLowerCase() : 'debit_rejected' }, status);
    }
    const jobId = debit.job_id;
    // The same send again: the turn already ran (or is running). Nothing is resubmitted or charged twice.
    if (debit.idempotent) return json({ replay: true, job_id: jobId, balance_after: debit.balance_after });

    const refundNow = async (reason) => {
        try { await rpc('ledger_refund', { p_job_id: jobId, p_user_id: ctx.user_id, p_credits: credits, p_reason: reason }, cfg); }
        catch (err) { console.error('[chat] refund failed, the job stays for the sweep:', err && err.message); }
    };

    try {
        const sub = await rpc('job_submitted', { p_job_id: jobId, p_provider: PROVIDER, p_provider_job_id: jobId }, cfg);
        if (!sub || sub.ok !== true) throw new Error(`job_submitted ${sub && sub.code}`);
    } catch (err) {
        console.error('[chat] job_submitted failed:', err && err.message);
        try { await rpc('job_submit_rejected', { p_job_id: jobId, p_error_code: 'provider_submit_failed' }, cfg); } catch { /* the refund still runs */ }
        await refundNow('refund:submit_failed');
        return json({ error: 'provider_submit_failed' }, 502);
    }

    const messages = buildMessages({ systemPrompt: ctx.system_prompt, history: ctx.history, text: turn.text });
    const ac = new AbortController();
    let stopped = false; // the user ended it: Stop pressed, or the browser closed the stream
    const stop = () => { stopped = true; ac.abort(); };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => ac.abort(new DOMException('Timed out', 'TimeoutError')), PROVIDER_TIMEOUT_MS);
    const enc = new TextEncoder();

    const sseStream = new ReadableStream({
        async start(controller) {
            const send = (event, data) => { try { controller.enqueue(enc.encode(sseFrame(event, data))); } catch { /* client gone */ } };
            let out = '';
            const sources = [];
            let failure = null;
            send('start', { job_id: jobId, credits, balance_after: debit.balance_after });
            try {
                for await (const piece of stream({ apiKey, model: model.provider_endpoint, messages, maxTokens: budget.maxTokens, reasoningEffort: budget.reasoningEffort, webSearch: turn.options.web, signal: ac.signal })) {
                    if (piece.source) { sources.push(piece.source); continue; }
                    out += piece.delta;
                    send('delta', { text: piece.delta });
                }
                // Web search: the pages it used go at the end of the reply, stored with it. Never on a reply
                // that was stopped, and never if they would push the stored text past its limit.
                const md = out && !ac.signal.aborted ? sourcesMarkdown(sources) : '';
                if (md && out.length + md.length <= MAX_STORED_REPLY) { out += md; send('delta', { text: md }); }
            } catch (err) {
                if (!ac.signal.aborted) failure = err instanceof ChatProviderError ? err.code : 'provider_unavailable';
                else if (ac.signal.reason && ac.signal.reason.name === 'TimeoutError') failure = 'provider_timeout';
            } finally {
                clearTimeout(timer);
            }

            let result;
            try {
                result = await finish({ rpc, cfg, jobId, threadId, credits, userText: turn.text, out, failure, stopped, refundNow });
            } catch (err) {
                // Nothing here is lost: the job is still SUBMITTED and the sweep refunds it.
                console.error('[chat] finishing the turn failed:', err && err.message);
                send('error', { error: 'turn_not_saved' });
                send('done', { status: 'failed', credits_charged: 0 });
                try { controller.close(); } catch { /* closed */ }
                return;
            }
            if (result.status === 'failed') send('error', { error: ERROR_CODE_RE.test(failure || '') ? failure : 'provider_unavailable' });
            if (result.status === 'error') send('error', { error: ERROR_CODE_RE.test(failure || '') ? failure : 'provider_cut_off' });
            let balance;
            try { balance = (await rpc('read_user_credits', { p_auth_id: authId }, cfg)).balance; } catch { /* optional */ }
            send('done', { status: result.status, credits_charged: result.charged ? credits : 0, message_id: result.messageId, ...(balance !== undefined ? { balance } : {}) });
            try { controller.close(); } catch { /* closed */ }
        },
        cancel() { stop(); },
    });

    return new Response(sseStream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

/**
 * The endings. Returns { status, charged, messageId } where status is
 *   complete | canceled (text kept, charged)   error (text kept, refunded)
 *   failed (provider gave nothing, refunded)   canceled with charged false (stopped before any text, refunded)
 */
async function finish({ rpc, cfg, jobId, threadId, credits, userText, out, failure, stopped, refundNow }) {
    if (!out) {
        // Nothing the user can use. Record why, then give the Credits back; no messages are stored.
        const code = ERROR_CODE_RE.test(failure || '') ? failure : 'user_canceled';
        try { await rpc('job_failed', { p_provider_job_id: jobId, p_provider: PROVIDER, p_error_code: code }, cfg); }
        catch (err) { console.error('[chat] job_failed errored:', err && err.message); }
        await refundNow('refund:provider_failed');
        return { status: failure ? 'failed' : 'canceled', charged: false };
    }
    // A provider failure wins over a stop: a cut-off reply is refunded even if the user also pressed Stop.
    const status = failure ? 'error' : stopped ? 'canceled' : 'complete';
    const saved = await rpc('chat_complete_turn', {
        p_job_id: jobId, p_thread_id: threadId, p_user_text: userText, p_reply: out, p_status: status,
    }, cfg);
    if (!saved || saved.ok !== true) throw new Error(`chat_complete_turn ${saved && saved.code}`);
    if (saved.refund) {
        await refundNow('refund:provider_failed');
        return { status: 'error', charged: false, messageId: saved.message_id };
    }
    return { status, charged: true, messageId: saved.message_id };
}
