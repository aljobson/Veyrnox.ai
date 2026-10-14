import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET, POST } = await import('../app/api/webhook/social/meta/route.js');

const secret = 'meta-webhook-test-secret';
Object.assign(process.env, {
    META_WEBHOOK_VERIFY_TOKEN: 'verify-test-token',
    META_WEBHOOK_APP_SECRET: secret,
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    PUBLISH_RUNTIME_FLAGS: '{"inbox":"true"}',
});

const payload = { object: 'instagram', entry: [{ id: 'ig-account', time: 1791970000,
    changes: [{ field: 'comments', value: { id: 'comment-1', text: 'Great post', from: { id: 'visitor', username: 'reader' }, media: { id: 'media-1' } } }],
}] };

function signedRequest(body = payload, valid = true) {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return new Request('https://veyrnox.test/api/webhook/social/meta', { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${valid ? signature : '0'.repeat(64)}` } });
}

test('Meta webhook subscription challenge requires the configured verification token', async () => {
    const accepted = await GET(new Request('https://veyrnox.test/api/webhook/social/meta?hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=12345'));
    assert.equal(accepted.status, 200);
    assert.equal(await accepted.text(), '12345');
    const rejected = await GET(new Request('https://veyrnox.test/api/webhook/social/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345'));
    assert.equal(rejected.status, 403);
});

test('invalid signatures cannot reach inbox storage', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json({ ok: true }); };
    const response = await POST(signedRequest(payload, false));
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
});

test('a signed Meta event is normalized and passed to the idempotent inbox RPC', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return Response.json({ ok: true });
    };
    const response = await POST(signedRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, accepted: 1 });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rpc\/ingest_social_inbox_event$/);
    assert.deepEqual(calls[0].body, {
        p_network: 'instagram', p_external_account_id: 'ig-account', p_provider_thread_id: 'comment-1',
        p_kind: 'comment', p_provider_message_id: 'comment-1', p_direction: 'inbound', p_body: 'Great post',
        p_media: [], p_participant_external_id: 'visitor', p_participant_name: 'reader', p_participant_avatar_url: null,
        p_subject: 'Instagram comment', p_provider_url: null, p_can_reply: true,
        p_sent_at: new Date(1791970000 * 1000).toISOString(),
    });
});
