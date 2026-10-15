import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMetaInboxEvents, verifyMetaWebhookSignature } from '../lib/social/metaInboxWebhook.js';
import { safeInboxFailureCode, sendInboxReply } from '../packages/adapters/social/inbox.js';

test('normalizes Instagram comments and direct messages without copying unknown webhook fields', () => {
    const events = parseMetaInboxEvents({ object: 'instagram', entry: [{ id: 'ig-1', time: 1791970000,
        changes: [{ field: 'comments', value: { id: 'comment-1', text: 'Hello', from: { id: 'person-1', username: 'visitor' }, media: { id: 'media-1' }, ignored_secret: 'no' } }],
        messaging: [{ sender: { id: 'person-2' }, recipient: { id: 'ig-1' }, timestamp: 1791970000000, message: { mid: 'message-1', text: 'Question' } }],
    }] });
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { network: 'instagram', externalAccountId: 'ig-1', providerThreadId: 'comment-1', kind: 'comment',
        providerMessageId: 'comment-1', direction: 'inbound', body: 'Hello', media: [], participantExternalId: 'person-1',
        participantName: 'visitor', participantAvatarUrl: null, subject: 'Instagram comment', providerUrl: null, canReply: true,
        sentAt: new Date(1791970000 * 1000).toISOString() });
    assert.deepEqual([events[1].kind, events[1].providerThreadId, events[1].direction, events[1].body], ['message', 'person-2', 'inbound', 'Question']);
    assert.equal(JSON.stringify(events).includes('ignored_secret'), false);
});

test('normalizes Facebook comments, reviews and message echoes', () => {
    const events = parseMetaInboxEvents({ object: 'page', entry: [{ id: 'page-1', time: 1791970000,
        changes: [
            { field: 'feed', value: { item: 'comment', comment_id: 'page-1_99', post_id: 'page-1_4', message: 'Nice', from: { id: 'reader', name: 'Reader' } } },
            { field: 'ratings', value: { review_id: 'review-1', review_text: 'Excellent', rating: 5, reviewer_id: 'reader' } },
        ], messaging: [{ sender: { id: 'page-1' }, recipient: { id: 'reader' }, timestamp: 1791970000000, message: { mid: 'echo-1', text: 'Thanks', is_echo: true } }],
    }] });
    assert.deepEqual(events.map((event) => [event.kind, event.direction, event.canReply]), [
        ['comment', 'inbound', true], ['review', 'inbound', false], ['message', 'outbound', false],
    ]);
    assert.equal(events[0].providerThreadId, 'page-1_99');
});

test('verifies the exact Meta webhook bytes with sha256 HMAC', async () => {
    const bytes = new TextEncoder().encode('{"object":"page"}');
    const secret = 'test-meta-secret';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
    const signature = `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    assert.equal(await verifyMetaWebhookSignature(bytes, signature, secret), true);
    assert.equal(await verifyMetaWebhookSignature(new TextEncoder().encode('changed'), signature, secret), false);
    assert.equal(await verifyMetaWebhookSignature(bytes, 'sha1=bad', secret), false);
});

test('sends Instagram and Facebook comment replies through their expected endpoints', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url, init, message: init.body.get('message') });
        return Response.json({ id: `reply-${calls.length}` });
    };
    assert.deepEqual(await sendInboxReply({ network: 'instagram', kind: 'comment', providerThreadId: 'ig_comment:1', body: 'Thanks', accessToken: 'secret-token' }, fetcher), { providerMessageId: 'reply-1' });
    assert.deepEqual(await sendInboxReply({ network: 'facebook', kind: 'comment', providerThreadId: 'fb.comment_2', body: 'Welcome', accessToken: 'secret-token' }, fetcher), { providerMessageId: 'reply-2' });
    assert.match(calls[0].url, /^https:\/\/graph\.instagram\.com\/v25\.0\/ig_comment%3A1\/replies$/);
    assert.match(calls[1].url, /^https:\/\/graph\.facebook\.com\/v23\.0\/fb\.comment_2\/comments$/);
    assert.deepEqual(calls.map((call) => [call.init.method, call.init.headers.Authorization, call.message]), [
        ['POST', 'Bearer secret-token', 'Thanks'], ['POST', 'Bearer secret-token', 'Welcome'],
    ]);
});

test('fails closed for unsupported reply types and exposes only safe failure labels', async () => {
    await assert.rejects(sendInboxReply({ network: 'facebook', kind: 'message', providerThreadId: 'x', body: 'hello', accessToken: 'secret-token' }, () => assert.fail()), /reply_unavailable/);
    assert.equal(safeInboxFailureCode(new Error('provider_reply_failed_403')), 'provider_403');
    assert.equal(safeInboxFailureCode(new Error('token-value-was-secret')), 'provider_failed');
});
