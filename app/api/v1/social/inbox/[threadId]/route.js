import { NextResponse } from 'next/server';
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { publishPlansEnabled, socialInboxEnabled } from '../../../../../../lib/social/publishFeature.js';
import { socialPostWriteLimit } from '../../../../../../lib/socialPostWriteLimit.js';
import { resolveBrand } from '../../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['read', 'unread', 'resolve', 'reopen']);
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
    const status = result?.code === 'PLAN_REQUIRED' ? 402 : result?.code === 'THREAD_NOT_FOUND' ? 404
        : ['INVALID_ACTION'].includes(result?.code) ? 400 : 502;
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
        const result = await rpc('get_social_inbox_thread', { p_auth_id: brand.rpcAuthId, p_thread_id: threadId }, resolved.cfg);
        if (result?.ok === true) {
            const accounts = await rpc('list_social_accounts', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, resolved.cfg);
            if (!accounts?.ok || !accounts.accounts?.some((account) => account.id === result.thread?.account_id)) return rpcFailure({ code: 'THREAD_NOT_FOUND' });
        }
        return result?.ok === true ? NextResponse.json({ thread: result.thread, messages: result.messages || [] }, { headers }) : rpcFailure(result);
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
    if (!body || Object.keys(body).length !== 1 || !ACTIONS.has(body.action)) return NextResponse.json({ error: 'invalid_action' }, { status: 400, headers });
    const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/inbox/thread:PATCH', { request: req, allowedRoles: ['owner'] });
    if (brand.error) return brand.error;
    const rate = await socialPostWriteLimit(resolved.authId, resolved.cfg); if (rate) return rate;
    try {
        const detail = await rpc('get_social_inbox_thread', { p_auth_id: brand.rpcAuthId, p_thread_id: threadId }, resolved.cfg);
        const accounts = detail?.ok ? await rpc('list_social_accounts', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, resolved.cfg) : null;
        if (!detail?.ok || !accounts?.ok || !accounts.accounts?.some((account) => account.id === detail.thread?.account_id)) return rpcFailure({ code: 'THREAD_NOT_FOUND' });
        const result = await rpc('update_social_inbox_thread', { p_auth_id: brand.rpcAuthId, p_thread_id: threadId, p_action: body.action }, resolved.cfg);
        return result?.ok === true ? NextResponse.json({ updated: true }, { headers }) : rpcFailure(result);
    } catch (error) {
        console.error('[api/v1/social/inbox/thread:PATCH] update failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers });
    }
}
