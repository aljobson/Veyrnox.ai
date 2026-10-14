import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { parseMetaInboxEvents, verifyMetaWebhookSignature } from '../../../../../lib/social/metaInboxWebhook.js';
import { socialInboxEnabled } from '../../../../../lib/social/publishFeature.js';
import { envConfig, rpc } from '../../../../../packages/db/supabase-client.js';

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

export async function GET(req) {
    if (!socialInboxEnabled()) return json({ error: 'not_configured' }, 503);
    const url = new URL(req.url);
    const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!token || url.searchParams.get('hub.mode') !== 'subscribe' || url.searchParams.get('hub.verify_token') !== token) return json({ error: 'verification_failed' }, 403);
    const challenge = url.searchParams.get('hub.challenge');
    if (!challenge || challenge.length > 256) return json({ error: 'verification_failed' }, 403);
    return new Response(challenge, { status: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(req) {
    if (!socialInboxEnabled()) return json({ error: 'not_configured' }, 503);
    // A webhook subscription belongs to one Meta app. Keep its signing secret
    // explicit so credentials for another Instagram/Facebook app cannot be
    // accepted accidentally when environments contain more than one app.
    const secret = process.env.META_WEBHOOK_APP_SECRET || process.env.META_APP_SECRET;
    const cfg = envConfig();
    if (!secret || !cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const limited = await limitRequestBody(req); if (limited.response) return limited.response;
    const raw = new Uint8Array(await limited.request.arrayBuffer());
    if (!await verifyMetaWebhookSignature(raw, req.headers.get('x-hub-signature-256'), secret)) return json({ error: 'invalid_signature' }, 401);
    let payload; try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'invalid_body' }, 400); }
    const events = parseMetaInboxEvents(payload);
    let accepted = 0;
    for (const event of events) {
        try {
            const result = await rpc('ingest_social_inbox_event', {
                p_network: event.network, p_external_account_id: event.externalAccountId, p_provider_thread_id: event.providerThreadId,
                p_kind: event.kind, p_provider_message_id: event.providerMessageId, p_direction: event.direction, p_body: event.body,
                p_media: event.media, p_participant_external_id: event.participantExternalId, p_participant_name: event.participantName,
                p_participant_avatar_url: event.participantAvatarUrl, p_subject: event.subject, p_provider_url: event.providerUrl,
                p_can_reply: event.canReply, p_sent_at: event.sentAt,
            }, cfg);
            if (result?.ok) accepted += 1;
        } catch { console.error('[webhook/social/meta] inbox event storage failed'); }
    }
    return json({ received: true, accepted });
}
