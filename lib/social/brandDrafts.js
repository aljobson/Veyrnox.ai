/**
 * Weekly draft posts for Veyrnox's own brand accounts (ADR-0061 amendment,
 * owner decision of 2026-10-02).
 *
 * Once a week the brand owner's generations from the last 7 days become one
 * batch of draft posts, through create_social_post_draft (0182). Nothing is
 * published until the owner approves the batch on /app/publish; they discard
 * what they don't want. Captions are catalog data (model name and its
 * /models page), never written copy.
 *
 * Off unless PUBLISH_ENABLED is "true" and BRAND_DRAFTS_AUTH_ID names the
 * owner's auth id.
 */

import { rpc, select } from '../../packages/db/supabase-client.js';

const SITE = 'veyrnox.ai';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOOKBACK_DAYS = 7;
export const MAX_DRAFTS = 7;
const CANDIDATE_JOBS = 50;
// Mondays 06:00–06:59 UTC; the batch id makes every later tick a no-op.
const RUN_WEEKDAY_UTC = 1;
const RUN_HOUR_UTC = 6;
const POST_HOUR_UTC = 16;

// What each adapter can publish (packages/adapters/social/*): TikTok takes
// photo posts, YouTube takes video, the rest take images.
export const NETWORK_MEDIA = { instagram: 'image', linkedin: 'image', twitter: 'image', tiktok: 'image', youtube: 'video' };

export function mediaTypeOf(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    return null;
}

export function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic UUID for (owner, ISO week), so a week has exactly one batch. */
export async function batchIdFor(ownerAuthId, weekKey) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`brand-drafts:${ownerAuthId}:${weekKey}`)));
    const b = digest.slice(0, 16);
    b[6] = (b[6] & 0x0f) | 0x50; // version 5 layout
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isRunWindow(now) {
    return now.getUTCDay() === RUN_WEEKDAY_UTC && now.getUTCHours() === RUN_HOUR_UTC;
}

export function captionFor(model) {
    return `Made with ${model.title} on Veyrnox.ai. ${SITE}/models/${model.id}`;
}

/**
 * Pure planning step. jobs: [{ id, model_id, mime_type }] newest first;
 * models: shelf models [{ id, title }]; accounts: active [{ id, network }].
 * One draft per job, at most MAX_DRAFTS, one a day at POST_HOUR_UTC from
 * the day after `now`, each targeting only accounts that take its media.
 */
export function planDrafts({ jobs, models, accounts, alreadyDrafted = new Set(), now }) {
    const byId = new Map(models.map((m) => [m.id, m]));
    const plans = [];
    for (const job of jobs) {
        if (plans.length >= MAX_DRAFTS) break;
        if (alreadyDrafted.has(job.id)) continue;
        const model = byId.get(job.model_id);
        const mediaType = mediaTypeOf(job.mime_type);
        if (!model || !mediaType) continue;
        const accountIds = accounts.filter((a) => NETWORK_MEDIA[a.network] === mediaType).map((a) => a.id);
        if (accountIds.length === 0) continue;
        const day = plans.length + 1;
        const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, POST_HOUR_UTC));
        plans.push({
            jobId: job.id, mediaType, accountIds, text: captionFor(model),
            scheduledAt: at.toISOString(), idempotencyKey: `auto-${job.id}`,
        });
    }
    return plans;
}

const enc = encodeURIComponent;

/**
 * @param {{ cfg: {supabaseUrl?: string, serviceRoleKey?: string}, ownerAuthId?: string,
 *   publishOn: boolean, loadModels: () => Promise<Array<{id: string, title: string}>>,
 *   now?: Date, force?: boolean, db?: { rpc: typeof rpc, select: typeof select } }} args
 */
export async function runBrandDrafts({ cfg, ownerAuthId, publishOn, loadModels, now = new Date(), force = false, db = { rpc, select } }) {
    if (!publishOn) return { ok: true, skipped: 'publish_disabled' };
    if (process.env.PUBLISH_RELEASED_NETWORKS !== undefined && process.env.PUBLISH_RELEASED_NETWORKS !== '*') return { ok: true, skipped: 'limited_network_release' };
    if (!ownerAuthId || !UUID_RE.test(ownerAuthId) || !cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return { ok: true, skipped: 'not_configured' };
    }
    if (!force && !isRunWindow(now)) return { ok: true, skipped: 'not_run_window' };

    const batchId = await batchIdFor(ownerAuthId, isoWeekKey(now));
    const ran = await db.select('social_posts', { columns: 'id', filter: `draft_batch_id=eq.${enc(batchId)}`, limit: 1 }, cfg);
    if (ran.length > 0) return { ok: true, skipped: 'already_ran', batchId };

    const [owner] = await db.select('users', { columns: 'id', filter: `auth_id=eq.${enc(ownerAuthId)}`, limit: 1 }, cfg);
    if (!owner) return { ok: false, error: 'owner_not_found' };
    const brand = await db.rpc('get_or_create_default_social_brand', { p_auth_id: ownerAuthId }, cfg);
    if (!brand || !brand.ok) return { ok: false, error: 'brand_unavailable' };

    const accounts = await db.select('social_accounts',
        { columns: 'id,network', filter: `brand_id=eq.${enc(brand.brand_id)}&status=eq.active` }, cfg);
    if (accounts.length === 0) return { ok: true, skipped: 'no_accounts', batchId };

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const jobs = await db.select('jobs', {
        columns: 'id,model_id',
        filter: `user_id=eq.${enc(owner.id)}&state=eq.STORED&created_at=gte.${enc(since)}&order=created_at.desc`,
        limit: CANDIDATE_JOBS,
    }, cfg);
    if (jobs.length === 0) return { ok: true, created: 0, batchId };

    const ids = jobs.map((j) => j.id).join(',');
    const assets = await db.select('assets', { columns: 'job_id,mime_type', filter: `job_id=in.(${enc(ids)})` }, cfg);
    const mimeByJob = new Map();
    for (const a of assets) if (!mimeByJob.has(a.job_id)) mimeByJob.set(a.job_id, a.mime_type);
    const keys = jobs.map((j) => `auto-${j.id}`).join(',');
    const drafted = await db.select('social_posts',
        { columns: 'idempotency_key', filter: `brand_id=eq.${enc(brand.brand_id)}&idempotency_key=in.(${enc(keys)})` }, cfg);
    const alreadyDrafted = new Set(drafted.map((p) => p.idempotency_key.slice('auto-'.length)));

    const plans = planDrafts({
        jobs: jobs.filter((j) => mimeByJob.has(j.id)).map((j) => ({ ...j, mime_type: mimeByJob.get(j.id) })),
        models: await loadModels(), accounts, alreadyDrafted, now,
    });

    let created = 0;
    const errors = [];
    for (const p of plans) {
        const r = await db.rpc('create_social_post_draft', {
            p_auth_id: ownerAuthId, p_brand_id: brand.brand_id, p_batch_id: batchId,
            p_scheduled_at: p.scheduledAt, p_global_text: p.text, p_idempotency_key: p.idempotencyKey,
            p_account_ids: p.accountIds, p_media: [{ media_type: p.mediaType, job_id: p.jobId }],
        }, cfg);
        if (r && r.ok && !r.idempotent) created++;
        else if (!r || !r.ok) errors.push(r && r.code ? r.code : 'unknown');
    }
    return { ok: errors.length === 0, created, planned: plans.length, errors, batchId };
}
