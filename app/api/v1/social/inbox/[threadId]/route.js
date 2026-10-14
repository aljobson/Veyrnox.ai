import { NextResponse } from 'next/server';
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { publishPlansEnabled, socialInboxEnabled } from '../../../../../../lib/social/publishFeature.js';
import { socialPostWriteLimit } from '../../../../../../lib/socialPostWriteLimit.js';
import { resolveBrand } from '../../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['read', 'unread', 'resolve', 'reopen']);
const WORKFLOW_ACTIONS = new Set(['assign', 'unassign', 'priority', 'tags']);
const PRIORITIES = new Set(['normal', 'high', 'urgent']);
const headers = { 'Cache-Control': 'no-store' };

function identity(req, threadId) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers }) };
    if (!UUID.test(threadId || '')) return { error: NextResponse.json({ error: 'invalid_thread_id' }, { status: 400, headers }) };
    if (!socialInboxEnabled()) return { error: NextResponse.json({ error: 'publish_inbox_not_open' }, { status: 503, headers }) };
    if (!publishPlansEnabled()) return { error: NextResponse.json({ error: 'publish_plans_not_open' }, { status: 503, headers }) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers }) };
    return { authId, cfg };
}

function rpcFailure(result) {
    const status = result?.code === 'PLAN_REQUIRED' ? 402 : result?.code === 'FORBIDDEN' ? 403 : result?.code === 'THREAD_NOT_FOUND' ? 404
        : ['INVALID_ACTION', 'INVALID_ASSIGNEE', 'INVALID_PRIORITY', 'INVALID_TAGS', 'INVALID_NOTE'].includes(result?.code) ? 400 : 502;
    return NextResponse.json({ error: String(result?.code || 'internal').toLowerCase() }, { status, headers });
}

export async function GET(req, context) {
    const { threadId } = await context.params;
    const resolved = identity(req, threadId); if (resolved.error) return resolved.error;
    const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/inbox/thread:GET', {
        request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
    });
    if (brand.error) return brand.error;
    try {
        const result = await rpc('get_social_inbox_thread', { p_auth_id: resolved.authId, p_brand_id: brand.brandId, p_thread_id: threadId }, resolved.cfg);
        return result?.ok === true ? NextResponse.json({ thread: result.thread, messages: result.messages || [], notes: result.notes || [] }, { headers }) : rpcFailure(result);
    } catch (error) {
        console.error('[api/v1/social/inbox/thread:GET] read failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers });
    }
}

export async function PATCH(req, context) {
    const { threadId } = await context.params;
    const resolved = identity(req, threadId); if (resolved.error) return resolved.error;
    const limited = await limitRequestBody(req); if (limited.response) return limited.response;
    let body; try { body = await limited.request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }); }
    const action = body?.action;
    if (!body || !ACTIONS.has(action) && !WORKFLOW_ACTIONS.has(action)) return NextResponse.json({ error: 'invalid_action' }, { status: 400, headers });
    let value = {};
    if (ACTIONS.has(action)) {
        if (Object.keys(body).length !== 1) return NextResponse.json({ error: 'invalid_action' }, { status: 400, headers });
    } else if (action === 'assign') {
        if (Object.keys(body).length !== 2 || !UUID.test(body.userId || '')) return NextResponse.json({ error: 'invalid_assignee' }, { status: 400, headers });
        value = { user_id: body.userId };
    } else if (action === 'unassign') {
        if (Object.keys(body).length !== 1) return NextResponse.json({ error: 'invalid_assignee' }, { status: 400, headers });
    } else if (action === 'priority') {
        if (Object.keys(body).length !== 2 || !PRIORITIES.has(body.priority)) return NextResponse.json({ error: 'invalid_priority' }, { status: 400, headers });
        value = { priority: body.priority };
    } else {
        if (Object.keys(body).length !== 2 || !Array.isArray(body.tags) || body.tags.length > 10
            || body.tags.some((tag) => typeof tag !== 'string' || tag.trim().length < 1 || tag.trim().length > 32)) {
            return NextResponse.json({ error: 'invalid_tags' }, { status: 400, headers });
        }
        value = { tags: body.tags };
    }
    const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/inbox/thread:PATCH', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer'] });
    if (brand.error) return brand.error;
    const rate = await socialPostWriteLimit(resolved.authId, resolved.cfg); if (rate) return rate;
    try {
        const result = ACTIONS.has(action)
            ? await rpc('update_social_inbox_thread', { p_auth_id: resolved.authId, p_brand_id: brand.brandId, p_thread_id: threadId, p_action: action }, resolved.cfg)
            : await rpc('update_social_inbox_workflow', { p_auth_id: resolved.authId, p_brand_id: brand.brandId, p_thread_id: threadId, p_action: action, p_value: value }, resolved.cfg);
        return result?.ok === true ? NextResponse.json({ updated: true }, { headers }) : rpcFailure(result);
    } catch (error) {
        console.error('[api/v1/social/inbox/thread:PATCH] update failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers });
    }
}

export async function POST(req, context) {
    const { threadId } = await context.params;
    const resolved = identity(req, threadId); if (resolved.error) return resolved.error;
    const limited = await limitRequestBody(req); if (limited.response) return limited.response;
    let body; try { body = await limited.request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }); }
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (Object.keys(body || {}).length !== 1 || !note || note.length > 2000) return NextResponse.json({ error: 'invalid_note' }, { status: 400, headers });
    const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/inbox/thread:POST', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer'] });
    if (brand.error) return brand.error;
    const rate = await socialPostWriteLimit(resolved.authId, resolved.cfg); if (rate) return rate;
    try {
        const result = await rpc('add_social_inbox_note', { p_auth_id: resolved.authId, p_brand_id: brand.brandId, p_thread_id: threadId, p_body: note }, resolved.cfg);
        return result?.ok === true ? NextResponse.json({ note: result.note }, { status: 201, headers }) : rpcFailure(result);
    } catch (error) {
        console.error('[api/v1/social/inbox/thread:POST] note failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers });
    }
}
