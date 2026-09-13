/**
 * Job completion for providers whose callback is a "go and look" signal
 * (kie.ai, OpenRouter): the route verifies the callback, re-reads the task
 * from the provider with our key, then hands the authoritative outcome here.
 *
 * Same state machine as /api/webhook/fal:
 *   success: job_succeeded -> copy output to R2 -> job_stored
 *   fail:    job_failed -> ledger_refund
 * with webhook_events(source, external_id) dedup and processed_at marking.
 * Every step is idempotent, so a 500 is always safe to redeliver.
 */

import { rpc, select } from '../packages/db/supabase-client.js';
import { copyUrlToR2, envConfig as r2EnvConfig } from '../packages/adapters/r2.js';

// Failures a redelivery cannot fix; the sweep refunds the job instead.
const NON_RETRYABLE_COPY = /^(source url invalid|source host not allowed|source too large|source [34]\d\d)$/;
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function serviceHeaders(cfg) {
    return { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` };
}

/**
 * Our job for a provider task, with its catalog endpoint. Null when unknown.
 * @returns {Promise<{id:string,user_id:string,credits:number,state:string,provider_endpoint:string}|null>}
 */
export async function findJob(cfg, source, providerJobId) {
    if (!ID_RE.test(String(providerJobId || ''))) return null;
    const jobs = await select('jobs', {
        columns: 'id,user_id,credits,state,model_id',
        filter: `provider=eq.${encodeURIComponent(source)}&provider_job_id=eq.${encodeURIComponent(providerJobId)}&limit=1`,
    }, cfg);
    const job = Array.isArray(jobs) && jobs[0];
    if (!job) return null;
    const models = await select('model_catalog', {
        columns: 'provider,provider_endpoint',
        filter: `id=eq.${encodeURIComponent(job.model_id)}`,
    }, cfg);
    const model = Array.isArray(models) && models[0];
    // A job whose row no longer names this provider is not ours to complete.
    if (!model || model.provider !== source) return null;
    return { ...job, provider_endpoint: model.provider_endpoint };
}

export async function markProcessed(cfg, source, id) {
    await fetch(new URL(
        `/rest/v1/webhook_events?source=eq.${encodeURIComponent(source)}&external_id=eq.${encodeURIComponent(id)}`,
        cfg.supabaseUrl,
    ), {
        method: 'PATCH',
        headers: { ...serviceHeaders(cfg), 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed_at: new Date().toISOString() }),
    }).catch((err) => console.error(`[${source}-webhook] processed patch failed:`, err));
}

/** @returns {Promise<'new'|'duplicate'|'retry'>} */
export async function dedup(cfg, source, id, payload) {
    const res = await fetch(new URL('/rest/v1/webhook_events?on_conflict=source,external_id', cfg.supabaseUrl), {
        method: 'POST',
        headers: { ...serviceHeaders(cfg), 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify({ source, external_id: id, payload }),
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`webhook_events insert ${res.status}`);
    const rows = await res.json().catch(() => []);
    if (!(Array.isArray(rows) && rows.length === 0)) return 'new';
    const read = await fetch(new URL(
        `/rest/v1/webhook_events?select=processed_at&source=eq.${encodeURIComponent(source)}&external_id=eq.${encodeURIComponent(id)}&limit=1`,
        cfg.supabaseUrl,
    ), { headers: serviceHeaders(cfg) });
    if (!read.ok) throw new Error(`webhook_events read ${read.status}`);
    const existing = await read.json().catch(() => []);
    return Array.isArray(existing) && existing[0] && existing[0].processed_at === null ? 'retry' : 'duplicate';
}

async function assetKey(source, providerJobId, outputUrl, ext) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(outputUrl));
    const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${source}/${providerJobId}/${hex}${ext}`;
}

/**
 * @param {object} args
 * @param {string} args.source         'kie' | 'openrouter' (jobs.provider and webhook_events.source)
 * @param {{id:string,user_id:string,credits:number}} args.job  from findJob
 * @param {string} args.providerJobId
 * @param {{state:'success', outputUrl:string}|{state:'fail', errorCode:string}} args.outcome authoritative
 * @param {string} args.ext            file extension for the R2 key, e.g. '.mp4'
 * @param {object} [args.copyOptions]  extra copyUrlToR2 options (provider, authorization)
 * @param {object} args.cfg            Supabase config
 * @returns {Promise<{status:number, body:object}>}
 */
export async function completeJob({ source, job, providerJobId, outcome, ext, copyOptions = {}, cfg }) {
    const seen = await dedup(cfg, source, providerJobId, { state: outcome.state });
    if (seen === 'duplicate') return { status: 200, body: { ok: true, duplicate: true } };

    if (outcome.state === 'success') {
        const succeeded = await rpc('job_succeeded', { p_provider_job_id: providerJobId, p_provider: source }, cfg);
        // Not ok = already SUCCEEDED from an earlier attempt, or not in a
        // state that can succeed. Only the former may go on to fetch output.
        if (!(succeeded && succeeded.ok === true) && job.state !== 'SUCCEEDED') {
            console.warn(`[${source}-webhook] job_succeeded returned`, succeeded && succeeded.code);
            await markProcessed(cfg, source, providerJobId);
            return { status: 200, body: { ok: true, warn: 'job_not_completable' } };
        }
        const key = await assetKey(source, providerJobId, outcome.outputUrl, ext);
        const copy = await copyUrlToR2(outcome.outputUrl, key, r2EnvConfig(), { provider: source, ...copyOptions });
        if (!copy.ok) {
            console.error(`[${source}-webhook] R2 copy failed for`, providerJobId, copy.error);
            if (NON_RETRYABLE_COPY.test(String(copy.error || ''))) {
                await markProcessed(cfg, source, providerJobId);
                return { status: 200, body: { ok: true, warn: 'asset_store_failed' } };
            }
            return { status: 500, body: { error: 'asset_store_failed' } };
        }
        const stored = await rpc('job_stored', {
            p_provider_job_id: providerJobId,
            p_provider: source,
            p_r2_key: copy.r2Key,
            p_mime_type: copy.mimeType,
            p_size_bytes: copy.size,
        }, cfg);
        if (!stored || stored.ok !== true) {
            console.warn(`[${source}-webhook] job_stored returned`, stored && stored.code);
            return { status: 500, body: { error: 'job_stored_failed' } };
        }
    } else {
        const failed = await rpc('job_failed', {
            p_provider_job_id: providerJobId,
            p_provider: source,
            p_error_code: String(outcome.errorCode || 'provider_error').slice(0, 128),
        }, cfg);
        // Refund only a job that is FAILED now: this delivery moved it, or an
        // earlier one did and its refund did not land.
        if (!(failed && failed.ok === true) && job.state !== 'FAILED') {
            console.warn(`[${source}-webhook] job_failed returned`, failed && failed.code);
            await markProcessed(cfg, source, providerJobId);
            return { status: 200, body: { ok: true, warn: 'job_not_failable' } };
        }
        // ledger_refund is idempotent per job; the job facts come from our row,
        // never from the callback.
        const refund = await rpc('ledger_refund', {
            p_job_id: job.id,
            p_user_id: job.user_id,
            p_credits: job.credits,
            p_reason: 'refund:provider_failed',
        }, cfg);
        if (!refund || refund.ok !== true) {
            console.error(`[${source}-webhook] ledger_refund rejected`, providerJobId, refund && refund.code);
            return { status: 500, body: { error: 'refund_failed' } };
        }
    }

    await markProcessed(cfg, source, providerJobId);
    return { status: 200, body: { ok: true } };
}

/** Extension from a URL's last path segment, else `fallback`. */
export function extFromUrl(url, fallback) {
    try {
        const m = /\.([A-Za-z0-9]{2,5})$/.exec(new URL(url).pathname.split('/').pop() || '');
        if (m) return `.${m[1].toLowerCase()}`;
    } catch { /* fall through */ }
    return fallback;
}
