import { NextResponse } from 'next/server';
import { limitRequestBody } from '../../../../../../../lib/requestBodyLimit.js';
import { publishPlansEnabled, socialInboxEnabled } from '../../../../../../../lib/social/publishFeature.js';
import { socialPostWriteLimit } from '../../../../../../../lib/socialPostWriteLimit.js';
import { decryptToken, tokenCryptoConfig } from '../../../../../../../lib/social/tokenCrypto.js';
import { sendInboxReply, safeInboxFailureCode } from '../../../../../../../packages/adapters/social/inbox.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const headers = { 'Cache-Control': 'no-store' };

export async function POST(req, context) {
    const { threadId } = await context.params;
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers });
    if (!UUID.test(threadId || '')) return NextResponse.json({ error: 'invalid_thread_id' }, { status: 400, headers });
    if (!socialInboxEnabled()) return NextResponse.json({ error: 'publish_inbox_not_open' }, { status: 503, headers });
    if (!publishPlansEnabled()) return NextResponse.json({ error: 'publish_plans_not_open' }, { status: 503, headers });
    const cfg = envConfig(), cryptoCfg = tokenCryptoConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !cryptoCfg) return NextResponse.json({ error: 'inbox_not_configured' }, { status: 503, headers });
    const limitedBody = await limitRequestBody(req); if (limitedBody.response) return limitedBody.response;
    let body; try { body = await limitedBody.request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }); }
    if (!body || Object.keys(body).some((key) => !['body', 'idempotencyKey'].includes(key))
        || typeof body.body !== 'string' || body.body.trim().length < 1 || body.body.trim().length > 8000 || !KEY.test(body.idempotencyKey || '')) {
        return NextResponse.json({ error: 'invalid_reply' }, { status: 400, headers });
    }
    const rate = await socialPostWriteLimit(authId, cfg); if (rate) return rate;
    let created;
    try { created = await rpc('create_social_inbox_reply', { p_auth_id: authId, p_thread_id: threadId,
        p_body: body.body, p_idempotency_key: body.idempotencyKey }, cfg); }
    catch (error) {
        console.error('[api/v1/social/inbox/reply] create failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers });
    }
    if (created?.ok !== true) {
        const status = created?.code === 'PLAN_REQUIRED' ? 402 : created?.code === 'THREAD_NOT_FOUND' ? 404
            : created?.code === 'REPLY_UNAVAILABLE' ? 409 : created?.code === 'ACCOUNT_UNAVAILABLE' ? 409 : 400;
        return NextResponse.json({ error: String(created?.code || 'internal').toLowerCase() }, { status, headers });
    }
    if (created.idempotent) return NextResponse.json({ message_id: created.message_id, delivery_status: created.delivery_status, idempotent: true }, { headers });

    try {
        const accessToken = await decryptToken(created.access_token_enc, cryptoCfg);
        const delivered = await sendInboxReply({ network: created.network, kind: 'comment',
            providerThreadId: created.provider_thread_id, body: body.body, accessToken });
        await rpc('finish_social_inbox_reply', { p_message_id: created.message_id, p_success: true,
            p_provider_message_id: delivered.providerMessageId, p_failure_code: null }, cfg);
        return NextResponse.json({ message_id: created.message_id, delivery_status: 'sent' }, { status: 201, headers });
    } catch (error) {
        const failure = safeInboxFailureCode(error);
        try { await rpc('finish_social_inbox_reply', { p_message_id: created.message_id, p_success: false,
            p_provider_message_id: null, p_failure_code: failure }, cfg); } catch { console.error('[api/v1/social/inbox/reply] could not store delivery failure'); }
        return NextResponse.json({ error: failure }, { status: failure === 'reply_unavailable' ? 409 : 502, headers });
    }
}
