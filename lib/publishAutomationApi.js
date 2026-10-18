import { cancelPost, getAnalytics, listAccounts, listBrands, listPosts, reschedulePostAt, schedulePost } from './publishAutomation.js';

// Developer-API face of the Publish tools (ADR-0112): snake_case JSON in and
// out, mapped onto the adapter. Paths are relative to /api/v1/developer/publish.

const MAX_BODY = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['scheduled', 'published', 'failed', 'canceled']);
const NETWORKS = /^[a-z]{2,16}$/;

const err = (status, error) => ({ status, body: { error } });

async function readJson(request) {
    const text = await request.text();
    if (text.length > MAX_BODY) return { error: err(413, 'body_too_large') };
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: err(400, 'invalid_body') };
        return { value };
    } catch { return { error: err(400, 'invalid_json') }; }
}

function allowOnly(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
}

/** @returns {Promise<{status:number, body:object}>} */
export async function publishApi(request, segments) {
    const method = request.method;
    const query = new URL(request.url).searchParams;
    const brandFromQuery = query.get('brand_id') || undefined;
    const [resource, id, action] = segments;

    if (method === 'GET' && segments.length === 1) {
        if (resource === 'brands') return listBrands(request);
        if (resource === 'accounts') return listAccounts(request, { brandId: brandFromQuery });
        if (resource === 'posts') {
            const status = query.get('status') || undefined;
            const network = query.get('network') || undefined;
            if (status && !STATUSES.has(status)) return err(400, 'invalid_status');
            if (network && !NETWORKS.test(network)) return err(400, 'invalid_network');
            return listPosts(request, { status, network, from: query.get('from') || undefined, to: query.get('to') || undefined, brandId: brandFromQuery });
        }
        if (resource === 'analytics') {
            return getAnalytics(request, { accountId: query.get('account_id') || '', from: query.get('from'), to: query.get('to'), brandId: brandFromQuery });
        }
    }

    if (method === 'POST' && resource === 'posts' && segments.length === 1) {
        const { value, error } = await readJson(request);
        if (error) return error;
        if (!allowOnly(value, ['scheduled_at', 'text', 'account_ids', 'media', 'idempotency_key', 'brand_id'])) return err(400, 'invalid_body');
        const media = Array.isArray(value.media) ? value.media.map((item) => (item && typeof item === 'object' && allowOnly(item, ['media_type', 'job_id', 'upload_id'])
            ? { mediaType: item.media_type, jobId: item.job_id, uploadId: item.upload_id } : null)) : value.media;
        return schedulePost(request, { scheduledAt: value.scheduled_at, text: value.text, accountIds: value.account_ids,
            media, idempotencyKey: value.idempotency_key, brandId: value.brand_id });
    }

    if (method === 'POST' && resource === 'posts' && segments.length === 3 && UUID_RE.test(id || '')) {
        const { value, error } = await readJson(request);
        if (error) return error;
        if (action === 'reschedule') {
            if (!allowOnly(value, ['scheduled_at', 'expected_at', 'brand_id'])) return err(400, 'invalid_body');
            return reschedulePostAt(request, { postId: id, scheduledAt: value.scheduled_at, expectedAt: value.expected_at, brandId: value.brand_id });
        }
        if (action === 'cancel') {
            if (!allowOnly(value, ['expected_updated_at', 'brand_id'])) return err(400, 'invalid_body');
            return cancelPost(request, { postId: id, expectedUpdatedAt: value.expected_updated_at, brandId: value.brand_id });
        }
    }
    return err(404, 'not_found');
}
