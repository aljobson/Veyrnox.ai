/**
 * GET/POST /api/v1/social/drafts — review of draft posts (ADR-0061
 * amendment, 0182). Drafts come from lib/social/brandDrafts.js; nothing
 * publishes until the brand owner approves its batch here.
 *
 * GET response (200): { brand_id, drafts: [{ id, draft_batch_id,
 *   scheduled_at, global_text, created_at, media: [{ media_type, job_id }],
 *   networks: [string] }] }
 *
 * POST body: { action: 'approve', batchId } — schedules the batch;
 *            { action: 'discard', batchId, postId? } — cancels one draft,
 *            or every draft left in the batch.
 * POST response (200): { approved, failed } or { discarded }.
 */

import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function setup(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!isUuid(authId)) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
    }
    return { authId, cfg };
}

async function call(name, args, cfg, tag) {
    try {
        return { result: await rpc(name, args, cfg) };
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error(`[${tag}] ${name} failed:`, status, err && err.body);
        return { error: NextResponse.json({ error: 'internal' }, { status: 502 }) };
    }
}

export async function GET(req) {
    const { authId, cfg, error } = setup(req);
    if (error) return error;
    const limited = await accountReadLimit(authId, cfg, { brand_id: null, drafts: [] });
    if (limited) return limited;
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/drafts:GET');
    if (brand.error) return brand.error;

    const listed = await call('list_social_post_drafts', { p_auth_id: authId, p_brand_id: brand.brandId }, cfg, 'api/v1/social/drafts:GET');
    if (listed.error) return listed.error;
    if (!listed.result || listed.result.ok !== true) return NextResponse.json({ error: 'internal' }, { status: 502 });

    return NextResponse.json({ brand_id: brand.brandId, drafts: listed.result.drafts || [] },
        { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
    const { authId, cfg, error } = setup(req);
    if (error) return error;

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const action = body && body.action;
    if (action !== 'approve' && action !== 'discard') {
        return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
    }
    const batchId = body.batchId;
    if (!isUuid(batchId)) return NextResponse.json({ error: 'invalid_batch_id' }, { status: 400 });
    const postId = body.postId ?? null;
    if (postId !== null && (action !== 'discard' || !isUuid(postId))) {
        return NextResponse.json({ error: 'invalid_post_id' }, { status: 400 });
    }

    const limited = await socialPostWriteLimit(authId, cfg);
    if (limited) return limited;
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/drafts:POST');
    if (brand.error) return brand.error;

    const tag = 'api/v1/social/drafts:POST';
    const out = action === 'approve'
        ? await call('approve_social_post_batch', { p_auth_id: authId, p_brand_id: brand.brandId, p_batch_id: batchId }, cfg, tag)
        : await call('discard_social_post_drafts',
            { p_auth_id: authId, p_brand_id: brand.brandId, p_batch_id: batchId, p_post_id: postId }, cfg, tag);
    if (out.error) return out.error;
    const r = out.result;
    if (!r || r.ok !== true) {
        const code = r && r.code;
        const status = code === 'BRAND_NOT_FOUND' ? 404 : code === 'INVALID_BATCH' ? 400 : 502;
        return NextResponse.json({ error: code ? code.toLowerCase() : 'internal' }, { status });
    }
    const payload = action === 'approve' ? { approved: r.approved, failed: r.failed } : { discarded: r.discarded };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}
