import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { encryptToken, tokenCryptoConfig } from '../lib/social/tokenCrypto.js';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const threadRoute = await import('../app/api/v1/social/inbox/[threadId]/route.js');
const replyRoute = await import('../app/api/v1/social/inbox/[threadId]/reply/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const key = Buffer.alloc(32, 17).toString('base64');
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    SOCIAL_TOKEN_ENCRYPTION_KEY: key, PUBLISH_RUNTIME_FLAGS: '{"plans":"true","inbox":"true"}' });

const context = { params: Promise.resolve({ threadId }) };
const request = (method = 'GET', body) => new Request(`https://veyrnox.test/api/v1/social/inbox/${threadId}`, {
    method, headers: { 'x-veyrnox-auth-id': auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
});

test('thread detail and state updates stay owner-scoped through their RPCs', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, body: JSON.parse(init.body) });
        if (name === 'consume_social_post_write_request') return Response.json({ ok: true });
        if (name === 'update_social_inbox_thread') return Response.json({ ok: true });
        return Response.json({ ok: true, thread: { id: threadId, can_reply: false }, messages: [{ id: messageId }] });
    };
    const detail = await threadRoute.GET(request(), context);
    assert.equal(detail.status, 200);
    assert.deepEqual(await detail.json(), { thread: { id: threadId, can_reply: false }, messages: [{ id: messageId }] });
    const updated = await threadRoute.PATCH(request('PATCH', { action: 'resolve' }), context);
    assert.equal(updated.status, 200);
    assert.deepEqual(calls.map((call) => call.name), ['get_social_inbox_thread', 'consume_social_post_write_request', 'update_social_inbox_thread']);
    assert.deepEqual(calls.at(-1).body, { p_auth_id: auth, p_thread_id: threadId, p_action: 'resolve' });
});

test('thread updates reject unknown actions before consuming the write bucket', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json({ ok: true }); };
    const response = await threadRoute.PATCH(request('PATCH', { action: 'delete' }), context);
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
});

test('comment replies decrypt the stored token only server-side and finalize provider delivery', async () => {
    const encrypted = await encryptToken('provider-access-token', tokenCryptoConfig());
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const value = String(url);
        if (value.startsWith('https://db.test/')) {
            const name = new URL(value).pathname.split('/').pop();
            calls.push({ kind: 'rpc', name, body: JSON.parse(init.body) });
            if (name === 'consume_social_post_write_request') return Response.json({ ok: true });
            if (name === 'create_social_inbox_reply') return Response.json({ ok: true, idempotent: false,
                message_id: messageId, network: 'instagram', provider_thread_id: 'comment-42', access_token_enc: encrypted });
            if (name === 'finish_social_inbox_reply') return Response.json({ ok: true });
        }
        calls.push({ kind: 'provider', url: value, authorization: init.headers.Authorization, message: init.body.get('message') });
        return Response.json({ id: 'provider-reply-7' });
    };
    const response = await replyRoute.POST(new Request(`https://veyrnox.test/api/v1/social/inbox/${threadId}/reply`, {
        method: 'POST', headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Thanks for the comment.', idempotencyKey: 'reply:1234567890123456' }),
    }), context);
    assert.equal(response.status, 201);
    const responseBody = await response.json();
    assert.deepEqual(responseBody, { message_id: messageId, delivery_status: 'sent' });
    const provider = calls.find((call) => call.kind === 'provider');
    assert.equal(provider.url, 'https://graph.instagram.com/v25.0/comment-42/replies');
    assert.equal(provider.authorization, 'Bearer provider-access-token');
    assert.equal(provider.message, 'Thanks for the comment.');
    assert.deepEqual(calls.filter((call) => call.kind === 'rpc').map((call) => call.name),
        ['consume_social_post_write_request', 'create_social_inbox_reply', 'finish_social_inbox_reply']);
    assert.equal(JSON.stringify(responseBody).includes('provider-access-token'), false);
});
