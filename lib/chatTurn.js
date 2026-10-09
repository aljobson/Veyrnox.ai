/**
 * One chat turn (ADR-0067): check, debit, stream, then finish or refund.
 *
 *   1. rate check, then chat_turn_context (who owns the thread, which model, the history)
 *   2. the model must be an active text row of provider openrouter-chat; its Credits per reply is the price
 *   3. ledger_debit creates the job (kind 'chat'); job_submitted moves it to SUBMITTED
 *   4. stream the reply to the browser as server-sent events
 *   5. finish, exactly one of:
 *        text produced, stream complete or user stopped -> chat_complete_turn, job STORED, charged
 *        the same, but the messages cannot be stored    -> chat_settle_unsaved_turn, job STORED, charged, nothing stored
 *        text produced, provider cut off                -> chat_complete_turn 'error', then ledger_refund
 *        nothing produced (any reason)                  -> job_failed, then ledger_refund, nothing stored
 *
 * Web search on a row whose engine is 'capped' runs our own search first, before step 3: a failed or empty search is a typed
 * refusal with nothing charged. The plugin engine is unchanged.
 *
 * A reply that reached the user is charged whether or not it could be stored (ADR-0067 amendment 9): deleting the
 * chat does not undo the charge. Only when the database gives no answer at all (an outage, or the isolate cut after
 * a disconnect) does the job stay SUBMITTED, and sweep_stuck_jobs refunds it after 120 minutes: the safe direction
 * for the user. Every dependency is injected so the money paths are tested with fakes.
 */

import { rpc as realRpc, select as realSelect } from '../packages/db/supabase-client.js';
import { streamChat as realStream, completeChat as realComplete, ChatProviderError } from '../packages/adapters/openrouterChat.js';
import { searchWeb as realSearch, SearchError } from '../packages/adapters/exa.js';
import { runResearch, RESEARCH } from './chatResearch.js';
import { resolveUploadedSource, resolveAssetSource } from './resolveSource.js';
import { freeAllowanceOn, takeFreeJob } from './freeJob.js';
import { isClosedSend } from './chatSendClose.js';
import { envConfig as r2EnvConfig } from '../packages/adapters/r2.js';
import {
    MAX_HISTORY_CHARS, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_SECONDS,
    buildMessages, chatApiKey, replyBudget, replyPrice, searchApiKey, searchContextBlock, selectChatModels, sourcesFromResults, sourcesMarkdown, sseFrame, webEngine,
    MAX_IMAGE_EDGE, validateTurn, MODEL_ID_RE, UUID_RE, researchEnabled, researchSettings,
} from './chat.js';

const PROVIDER = 'openrouter-chat';
const PROVIDER_TIMEOUT_MS = 90_000;
const MAX_STORED_REPLY = 32000; // chat_messages.content limit (migration 0193)
// chat_complete_turn's answers that mean this turn's messages cannot be stored: the chat is gone, or the text is refused.
const UNSAVED_CODES = new Set(['THREAD_NOT_FOUND', 'INVALID_REPLY', 'INVALID_TEXT']);
const ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

function limited(r) {
    const retry = Math.max(1, Math.min(600, Number(r.retry_after_seconds) || RATE_WINDOW_SECONDS));
    return json({ error: 'rate_limited', limit: r.limit, count: r.count, retry_after_seconds: retry }, 429, { 'Retry-After': String(retry) });
}

/**
 * @param {{authId:string, threadId:string, body:unknown, signal?:AbortSignal, cfg:object,
 *          waitUntil?:((work:Promise<unknown>)=>void)|null, env?:Record<string,string|undefined>,
 *          deps?:{rpc?:Function, select?:Function, stream?:Function, resolveImage?:Function, search?:Function}}} args
 * @returns {Promise<Response>} JSON for a refusal, text/event-stream for a started turn
 */
export async function runChatTurn({ authId, threadId, body, signal, waitUntil, cfg, env = process.env, deps = {} }) {
    const rpc = deps.rpc || realRpc;
    const select = deps.select || realSelect;
    const stream = deps.stream || realStream;
    const search = deps.search || realSearch;
    const complete = deps.complete || realComplete;
    const resolveImage = deps.resolveImage || ((a, k) => resolveUploadedSource(a, k, r2EnvConfig()));
    const resolveAsset = deps.resolveAsset || ((a, id) => resolveAssetSource(a, id, r2EnvConfig(), cfg));

    if (!UUID_RE.test(threadId || '')) return json({ error: 'thread_not_found' }, 404);
    const turn = validateTurn(body);
    if (!turn.ok) return json({ error: turn.error }, 400);
    const apiKey = chatApiKey(env);
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
        const rows = await selectChatModels(select, {
            columns: 'id,provider,provider_endpoint,modality,credits_5s,gated_flag,active,chat_max_reply_tokens,chat_reasoning_effort,'
                + 'chat_thinking_effort,chat_thinking_max_reply_tokens,chat_thinking_extra_credits,chat_web_extra_credits,chat_web_engine,chat_images_extra_credits'
                // Asked for only when the flag is on, so a Worker running before migration 0205 never queries it.
                + (freeAllowanceOn(env) ? ',free_allowance_per_day' : '')
                // Research columns only when it is on: before migration 0208 a Worker must not query them. With it off a
                // research turn finds no offer on the row and is refused as option_unavailable.
                + (researchEnabled(env) ? ',chat_research_extra_credits,chat_research_write_max_tokens,chat_research_search_model' : ''),
            filter: `id=eq.${encodeURIComponent(ctx.model_id)}`,
        }, cfg);
        model = Array.isArray(rows) && rows[0];
    } catch (err) {
        console.error('[chat] catalog lookup failed:', err && err.message);
        return json({ error: 'catalog_lookup_failed' }, 502);
    }
    if (!model || !model.active || model.modality !== 'text' || model.provider !== PROVIDER) return json({ error: 'model_unavailable' }, 409);
    if (model.gated_flag) return json({ error: 'model_gated' }, 402);
    const assetIds = turn.assets || [];
    const price = replyPrice(model, { ...turn.options, images: turn.attachments.length + assetIds.length > 0 });
    if (!price.ok) return json({ error: price.error }, 409);
    // Attachments are checked before any money moves: the caller's own key, really an image, within the size cap.
    const attached = turn.attachments.length + assetIds.length ? await resolveAttachments(authId, turn.attachments, assetIds, resolveImage, resolveAsset) : null;
    if (attached && !attached.ok) return json({ error: attached.error }, attached.status);
    // Capped Web search: our own search, before any Credits move. Nothing is charged for a search that did not work.
    let searched = null;
    if (turn.options.web && webEngine(model) === 'capped') {
        const searchKey = searchApiKey(env);
        if (!searchKey) return json({ error: 'option_unavailable' }, 409);
        // The search costs us money before the debit can refuse anyone, so a caller who could not pay is turned away
        // first. A reply the free allowance may cover (price is the row's base) is left to the debit to decide.
        const maybeFree = freeAllowanceOn(env) && Number(model.free_allowance_per_day) > 0 && price.credits === Number(model.credits_5s);
        if (!maybeFree) {
            let spendable;
            try { spendable = Number((await rpc('read_user_credits', { p_auth_id: authId }, cfg)).balance); }
            catch (err) { console.error('[chat] balance check errored:', err && err.message); }
            if (!Number.isFinite(spendable)) return json({ error: 'balance_check_failed' }, 502);
            if (spendable < price.credits) return json({ error: 'insufficient_balance' }, 402);
        }
        try {
            searched = await search({ apiKey: searchKey, query: turn.text.trim(), signal });
        } catch (err) {
            const code = err instanceof SearchError ? err.code : 'search_unavailable';
            if (!(err instanceof SearchError)) console.error('[chat] search errored:', err && err.message);
            // Keys and billing are our business, not the user's: they only learn that search is not working.
            return json({ error: code === 'search_timeout' || code === 'search_rate_limited' ? code : 'search_unavailable' }, 502);
        }
        if (!searched.results.length) return json({ error: 'search_no_results' }, 409);
    }
    let credits = price.credits;
    const budget = replyBudget(model, turn.options);

    // ADR-0069: a plain reply (no Thinking, Web search or images, so the price is the row's base) can use a free
    // allowance. A reply with a paid option is priced normally: the extras are real extra cost.
    let debit = null;
    if (freeAllowanceOn(env) && Number(model.free_allowance_per_day) > 0 && credits === Number(model.credits_5s)) {
        debit = await takeFreeJob({
            rpc, cfg, authId, userId: ctx.user_id, key: turn.key, modelId: model.id,
            inputs: { kind: 'chat', thread_id: threadId, options: turn.options },
            limit: RATE_LIMIT_PER_WINDOW, windowSeconds: RATE_WINDOW_SECONDS,
        });
        if (debit && debit.free) credits = 0;
    }
    try {
        if (!debit) debit = await rpc('ledger_debit', {
            p_user_id: ctx.user_id,
            p_idempotency_key: turn.key,
            p_credits: credits,
            p_reason: 'debit:chat',
            p_model_id: model.id,
            // The job row never holds message text: that lives in chat_messages.
            p_inputs: {
                kind: 'chat', thread_id: threadId, options: turn.options, ...(attached ? attached.inputs : {}),
                // The engine and the provider's own cost for the search: the real figure, kept so the price can be checked against it.
                ...(searched ? { web_engine: 'capped', ...(searched.costUsd !== null ? { search_cost_usd: searched.costUsd } : {}) } : {}),
            },
            p_limit_per_window: RATE_LIMIT_PER_WINDOW,
            p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
    } catch (err) {
        // The person stopped this send before it started and it was then closed (amendment 11): the database refuses
        // to make its job, so nothing was debited. The reader has gone; this is not a failure of ours.
        if (isClosedSend(err)) return json({ error: 'send_closed' }, 409);
        console.error('[chat] ledger_debit failed:', err && err.message);
        return json({ error: 'debit_failed' }, 502);
    }
    if (debit && debit.ok === false && debit.code === 'RATE_LIMITED') return limited(debit);
    if (!debit || debit.ok === false) {
        const status = debit && debit.code === 'INSUFFICIENT_BALANCE' ? 402 : debit && debit.code === 'ACCOUNT_FROZEN' ? 403 : debit && debit.code === 'SEND_CLOSED' ? 409 : 400;
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

    const messages = buildMessages({
        systemPrompt: ctx.system_prompt, history: ctx.history, text: turn.text, images: attached ? attached.urls : [],
        searchContext: searched ? searchContextBlock(searched.results) : '',
    });
    const ac = new AbortController();
    let stopped = false; // the user ended it: Stop pressed, or the browser closed the stream
    const stop = () => { stopped = true; ac.abort(); };
    // A reader who has already gone never fires the listener, so that case is stopped here.
    if (signal && signal.aborted) stop();
    else if (signal) signal.addEventListener('abort', stop, { once: true });
    // A research run is plan, searches and a write, so it gets its own, longer ceiling (ADR-0070).
    const research = turn.options.research === true;
    const timer = setTimeout(() => ac.abort(new DOMException('Timed out', 'TimeoutError')), research ? RESEARCH.timeoutMs : PROVIDER_TIMEOUT_MS);
    const enc = new TextEncoder();

    const sseStream = turnStream({
        async start(controller) {
            const send = (event, data) => { try { controller.enqueue(enc.encode(sseFrame(event, data))); } catch { /* client gone */ } };
            let out = '';
            const sources = searched ? sourcesFromResults(searched.results) : [];
            let failure = null;
            send('start', { job_id: jobId, credits, balance_after: debit.balance_after });
            try {
                // Research: the plan and searches yield progress, then the answer streams like any other reply. A failure
                // before the write throws with nothing produced, so the turn refunds the whole price as it always has.
                const pieces = research
                    ? runResearch({ apiKey, model: model.provider_endpoint, searchModel: researchSettings(model).searchModel, question: turn.text,
                        systemPrompt: ctx.system_prompt, history: ctx.history, writeMaxTokens: researchSettings(model).writeMaxTokens,
                        signal: ac.signal, complete, stream })
                    : stream({ apiKey, model: model.provider_endpoint, messages, maxTokens: budget.maxTokens, reasoningEffort: budget.reasoningEffort, webSearch: turn.options.web === true && !searched, signal: ac.signal });
                for await (const piece of pieces) {
                    if (piece.progress) { send('progress', piece.progress); continue; }
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
            // A stream that ends quietly because the ceiling aborted it is a cut-off reply, not a finished one.
            if (!failure && !stopped && ac.signal.aborted && ac.signal.reason && ac.signal.reason.name === 'TimeoutError') failure = 'provider_timeout';

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
            if (result.unsaved) send('error', { error: 'reply_not_saved' });
            let balance;
            try { balance = (await rpc('read_user_credits', { p_auth_id: authId }, cfg)).balance; } catch { /* optional */ }
            send('done', { status: result.status, credits_charged: result.charged ? credits : 0, message_id: result.messageId, ...(balance !== undefined ? { balance } : {}) });
            try { controller.close(); } catch { /* closed */ }
        },
        cancel() { stop(); },
    }, waitUntil);

    return new Response(sseStream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

/**
 * Resolve each attached image for this caller: upload keys, then Library assets (the caller's own finished images, by
 * job id). Both pass the same checks: the caller's own, really an image, within the size cap. The job records upload
 * keys under `source_keys`, which is where the upload sweeper looks, so those files are deleted soon after the reply
 * instead of waiting out the age limit. A Library asset is recorded under `source_assets` and NEVER under
 * `source_keys`: the sweeper must not be able to delete a file the person still owns. The pixel size and type are kept
 * for the thread, never the file name.
 */
async function resolveAttachments(authId, keys, assetIds, resolveImage, resolveAsset) {
    let results;
    try {
        results = await Promise.all([...keys.map((k) => resolveImage(authId, k)), ...assetIds.map((id) => resolveAsset(authId, id))]);
    } catch (err) {
        console.error('[chat] attachment check failed:', err && err.message);
        return { ok: false, status: 502, error: 'attachment_check_failed' };
    }
    const urls = [], attachments = [], source_keys = {}, source_assets = {};
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const isAsset = i >= keys.length;
        if (!r || r.ok !== true) {
            if (r && r.error === 'internal') return { ok: false, status: 502, error: 'attachment_check_failed' };
            if (r && r.error === 'source_type_unsupported') return { ok: false, status: 400, error: 'attachment_type_unsupported' };
            return { ok: false, status: 400, error: r && r.error === 'source_not_found' ? 'attachment_not_found' : 'attachment_invalid' };
        }
        if (typeof r.contentType !== 'string' || !r.contentType.startsWith('image/')) return { ok: false, status: 400, error: 'attachment_type_unsupported' };
        const d = r.dimensions;
        if (!d || !(d.width > 0) || !(d.height > 0)) return { ok: false, status: 400, error: 'attachment_invalid' };
        if (Math.max(d.width, d.height) > MAX_IMAGE_EDGE) return { ok: false, status: 400, error: 'image_too_large' };
        urls.push(r.url);
        attachments.push({ type: r.contentType, width: d.width, height: d.height });
        if (isAsset) source_assets[`image_${i + 1}`] = assetIds[i - keys.length];
        else source_keys[`image_${i + 1}`] = keys[i];
    }
    return {
        ok: true, urls,
        inputs: {
            attachments,
            ...(Object.keys(source_keys).length ? { source_keys } : {}),
            ...(Object.keys(source_assets).length ? { source_assets } : {}),
        },
    };
}

/**
 * The reply as a message can hold it: no NUL, no half of a surrogate pair (Postgres refuses both), and no longer than
 * the column allows. The cut never ends on the first half of a pair.
 */
function storedReply(out) {
    const clean = out.replaceAll('\0', '').toWellFormed();
    if (clean.length <= MAX_STORED_REPLY) return clean;
    const last = clean.charCodeAt(MAX_STORED_REPLY - 1);
    return clean.slice(0, last >= 0xD800 && last <= 0xDBFF ? MAX_STORED_REPLY - 1 : MAX_STORED_REPLY);
}

/**
 * The endings. Returns { status, charged, messageId, unsaved } where status is
 *   complete | canceled (text kept, charged; `unsaved` when it was delivered but could not be stored)
 *   error (text kept, refunded)   failed (provider gave nothing, refunded)
 *   canceled with charged false (stopped before any text, refunded)
 */
async function finish({ rpc, cfg, jobId, threadId, credits, userText, out, failure, stopped, refundNow }) {
    const reply = storedReply(out);
    if (!reply) {
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
        p_job_id: jobId, p_thread_id: threadId, p_user_text: userText, p_reply: reply, p_status: status,
    }, cfg);
    if (!saved || saved.ok !== true) {
        // The reply reached the user but its messages cannot be stored. It is charged all the same: the job ends
        // STORED with no messages. A cut-off reply is never charged, so that one is left for the sweep to refund, as is
        // a settle that fails or is refused (a database from before migration 0233 has no such function).
        if (status !== 'error' && saved && UNSAVED_CODES.has(saved.code)) {
            console.error('[chat] the reply was delivered but could not be stored:', saved.code);
            const settled = await rpc('chat_settle_unsaved_turn', { p_job_id: jobId }, cfg);
            if (!settled || settled.ok !== true) throw new Error(`chat_settle_unsaved_turn ${settled && settled.code}`);
            return { status, charged: true, unsaved: true };
        }
        throw new Error(`chat_complete_turn ${saved && saved.code}`);
    }
    if (saved.refund) {
        await refundNow('refund:provider_failed');
        return { status: 'error', charged: false, messageId: saved.message_id };
    }
    return { status, charged: true, messageId: saved.message_id };
}

/**
 * The reply stream. Its start() is the whole turn, and that work is handed to the Worker's waitUntil (ADR-0067
 * amendment 10): pressing Stop or closing the tab ends the response, and the save and the charge still have to run.
 * Without a waitUntil (next dev, tests) the stream alone carries the work, as it always has.
 */
function turnStream(source, waitUntil) {
    return new ReadableStream({
        start(controller) {
            const work = source.start(controller);
            if (waitUntil) {
                try { waitUntil(work); }
                catch (err) { console.error('[chat] the turn could not be handed to waitUntil:', err && err.message); }
            }
            return work;
        },
        cancel(reason) { return source.cancel(reason); },
    });
}
