import { GET as readBrands } from '../app/api/v1/social/brands/route.js';
import { GET as readAccounts } from '../app/api/v1/social/accounts/route.js';
import { GET as readCalendar } from '../app/api/v1/social/calendar/route.js';
import { GET as readAnalytics } from '../app/api/v1/social/analytics/route.js';
import { POST as createPost } from '../app/api/v1/social/posts/route.js';
import { PATCH as patchPost } from '../app/api/v1/social/posts/[id]/route.js';
import { PATCH as reschedulePost } from '../app/api/v1/social/posts/[id]/schedule/route.js';
import { publishAutomationEnabled } from './social/publishFeature.js';

// ADR-0112. One in-process adapter over the signed-in Publish handlers, shared
// by the MCP connector and the developer API. It owns no business rule: plan
// tier, role, brand, rate limit, network release and media ownership are
// enforced by the handlers it calls, so a client can never reach more than the
// Publish web app can. It adds only conservative input limits for assistants.

const PUBLIC_ORIGIN = process.env.PUBLIC_HOST || 'https://veyrnox.ai';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const INSTANT_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const IDENTITY = ['x-veyrnox-auth-id', 'x-veyrnox-auth-email', 'x-veyrnox-auth-role',
    'x-veyrnox-auth-client-id', 'x-veyrnox-auth-aal', 'x-veyrnox-auth-mfa-at', 'x-request-id', 'cf-ipcountry'];

/** An assistant may only schedule, never publish immediately, and not in the next few minutes. */
export const MIN_LEAD_MS = 10 * 60 * 1000;
export const MAX_CALENDAR_DAYS = 43;
const DAY_MS = 86400000;

const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const isInstant = (value) => typeof value === 'string' && INSTANT_RE.test(value) && Number.isFinite(Date.parse(value));

function headersFor(source, brandId) {
    const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' });
    // Only values middleware wrote after JWT verification are copied.
    for (const name of IDENTITY) {
        const value = source.headers.get(name);
        if (value) headers.set(name, value);
    }
    if (brandId) headers.set('x-publish-brand-id', brandId);
    return headers;
}

async function call(handler, source, path, { method = 'GET', body, params, brandId } = {}) {
    if (!publishAutomationEnabled()) return fail(404, 'publish_automation_not_open');
    if (brandId !== undefined && brandId !== null && !isUuid(brandId)) return fail(400, 'invalid_brand_id');
    const request = new Request(new URL(path, PUBLIC_ORIGIN), {
        method, headers: headersFor(source, brandId),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
    const data = await response.json().catch(() => ({ error: `http_${response.status}` }));
    const retryAfter = Number(response.headers.get('retry-after'));
    return { status: response.status, body: retryAfter > 0 && !response.ok ? { ...data, retry_after_seconds: retryAfter } : data };
}

const ok = (result) => result.status >= 200 && result.status < 300;

export async function listBrands(source) {
    return call(readBrands, source, '/api/v1/social/brands');
}

export async function listAccounts(source, { brandId } = {}) {
    const result = await call(readAccounts, source, '/api/v1/social/accounts', { brandId });
    if (!ok(result)) return result;
    const data = result.body;
    return { status: 200, body: {
        brand_id: data.brand_id,
        role: data.brandRole,
        plan_tier: data.planTier || null,
        account_limit: data.accountLimit,
        accounts: (data.accounts || []).map((account) => ({
            id: account.id, network: account.network, display_name: account.display_name,
            status: account.status, connected_at: account.connected_at, token_expires_at: account.token_expires_at,
            publishing_enabled: account.publishingEnabled === true, supported_media: account.supportedMedia || [],
        })),
    } };
}

/**
 * Posts in a time window, newest status first. The calendar read also carries
 * the version stamp (`updated_at`) that cancel needs, and tells us whether a
 * post may still be changed.
 */
export async function listPosts(source, { status, from, to, network, brandId, now = Date.now() } = {}) {
    const start = from ?? new Date(now - (status === 'scheduled' || !status ? 0 : MAX_CALENDAR_DAYS * DAY_MS)).toISOString();
    const end = to ?? new Date(now + (status === 'scheduled' || !status ? MAX_CALENDAR_DAYS * DAY_MS : 0)).toISOString();
    if (!isInstant(start) || !isInstant(end) || Date.parse(end) <= Date.parse(start)) return fail(400, 'invalid_range');
    if (Date.parse(end) - Date.parse(start) > MAX_CALENDAR_DAYS * DAY_MS) return fail(400, 'range_too_long', { max_days: MAX_CALENDAR_DAYS });
    const query = new URLSearchParams({ from: start, to: end });
    if (status) query.set('status', status);
    if (network) query.set('network', network);
    const result = await call(readCalendar, source, `/api/v1/social/calendar?${query}`, { brandId });
    if (!ok(result)) return result;
    return { status: 200, body: { from: start, to: end, posts: result.body.posts || [], next: result.body.next || null } };
}

export async function getAnalytics(source, { accountId, from, to, brandId } = {}) {
    if (!isUuid(accountId)) return fail(400, 'invalid_account_id');
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return fail(400, 'invalid_range');
    const query = new URLSearchParams({ accountId, from, to });
    const result = await call(readAnalytics, source, `/api/v1/social/analytics?${query}`, { brandId });
    if (!ok(result)) return result;
    const data = result.body;
    const evolution = data.evolution || [];
    const posts = data.posts || [];
    // Metrics differ per network and some are levels (followers) not flows, so
    // report the endpoints of the period rather than a misleading sum.
    return { status: 200, body: {
        account: data.account, sync: data.sync, from, to,
        plan_tier: data.planTier || null, analytics_days: data.analyticsDays ?? null,
        days_with_data: evolution.length, first_day: evolution[0] || null, last_day: evolution.at(-1) || null,
        post_count: posts.length, recent_posts: posts.slice(0, 10),
    } };
}

export async function schedulePost(source, input = {}, now = Date.now()) {
    const { scheduledAt, text, accountIds, media, idempotencyKey, brandId } = input;
    if (!isInstant(scheduledAt)) return fail(400, 'invalid_schedule');
    if (Date.parse(scheduledAt) < now + MIN_LEAD_MS) return fail(400, 'schedule_too_soon', { minimum_minutes: MIN_LEAD_MS / 60000 });
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) return fail(400, 'invalid_idempotency_key');
    if (text != null && (typeof text !== 'string' || text.length > 4000)) return fail(400, 'invalid_global_text');
    if (!Array.isArray(accountIds) || accountIds.length < 1 || accountIds.length > 20
        || !accountIds.every(isUuid) || new Set(accountIds).size !== accountIds.length) return fail(400, 'invalid_account_ids');
    if (!Array.isArray(media) || media.length < 1 || media.length > 10) return fail(400, 'invalid_media');
    const items = [];
    for (const item of media) {
        const keys = item && typeof item === 'object' ? Object.keys(item) : [];
        if (!['image', 'video'].includes(item?.mediaType) || keys.some((key) => !['mediaType', 'jobId', 'uploadId'].includes(key))
            || Boolean(item.jobId) === Boolean(item.uploadId) || !isUuid(item.jobId ?? item.uploadId)) return fail(400, 'invalid_media');
        items.push({ mediaType: item.mediaType, ...(item.jobId ? { jobId: item.jobId } : { uploadId: item.uploadId }) });
    }
    // publishNow is never forwarded: this surface schedules, it does not post on the spot.
    const result = await call(createPost, source, '/api/v1/social/posts', { method: 'POST', brandId, body: {
        scheduledAt: new Date(scheduledAt).toISOString(), globalText: text ?? null, idempotencyKey, accountIds, media: items,
    } });
    if (!ok(result)) return result;
    return { status: result.status, body: {
        post_id: result.body.post_id, status: 'scheduled', idempotent: result.body.idempotent === true,
        target_count: result.body.target_count || 0, scheduled_at: new Date(scheduledAt).toISOString(),
    } };
}

export async function reschedulePostAt(source, { postId, scheduledAt, expectedAt, brandId } = {}, now = Date.now()) {
    if (!isUuid(postId)) return fail(400, 'invalid_post_id');
    if (!isInstant(scheduledAt) || !isInstant(expectedAt)) return fail(400, 'invalid_schedule');
    if (Date.parse(scheduledAt) < now + MIN_LEAD_MS) return fail(400, 'schedule_too_soon', { minimum_minutes: MIN_LEAD_MS / 60000 });
    const result = await call(reschedulePost, source, `/api/v1/social/posts/${postId}/schedule`, {
        method: 'PATCH', params: { id: postId }, brandId, body: { scheduledAt: new Date(scheduledAt).toISOString(), expectedAt },
    });
    if (!ok(result)) return result;
    return { status: 200, body: { post_id: postId, scheduled_at: result.body.scheduled_at, idempotent: result.body.idempotent === true } };
}

export async function cancelPost(source, { postId, expectedUpdatedAt, brandId } = {}) {
    if (!isUuid(postId)) return fail(400, 'invalid_post_id');
    if (!isInstant(expectedUpdatedAt)) return fail(400, 'invalid_body');
    const result = await call(patchPost, source, `/api/v1/social/posts/${postId}`, {
        method: 'PATCH', params: { id: postId }, brandId, body: { action: 'cancel', expectedUpdatedAt },
    });
    if (!ok(result)) return result;
    return { status: 200, body: { post_id: postId, status: 'canceled', updated_at: result.body.updated_at, idempotent: result.body.idempotent === true } };
}
