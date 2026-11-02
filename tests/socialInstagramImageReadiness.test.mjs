import test from 'node:test';
import assert from 'node:assert/strict';
import { publishImageStep } from '../packages/adapters/social/instagram.js';

test('image waits for its existing container before one public publish', async () => {
    const calls = [];
    let readiness = 'IN_PROGRESS';
    const fetcher = async url => {
        const u = new URL(url); calls.push(u.pathname + ':' + (u.searchParams.get('fields') || ''));
        if (u.pathname.endsWith('/media')) return Response.json({ id: '12345' });
        if (u.searchParams.get('fields') === 'status_code') return Response.json({ status_code: readiness });
        if (u.pathname.endsWith('/media_publish')) return Response.json({ id: '67890' });
        return Response.json({ permalink: 'https://www.instagram.com/p/example/' });
    };
    const base = { externalAccountId: '111', caption: 'caption', mediaType: 'image', mediaUrl: 'https://example.com/image.jpg', now: 100000 };
    let marked = 0;
    const mark = async () => { marked++; };
    const created = await publishImageStep('token', base, fetcher, mark);
    assert.equal(created.providerState.container_id, '12345');
    const waiting = await publishImageStep('token', { ...base, state: created.providerState, now: 160000 }, fetcher, mark);
    assert.equal(waiting.inProgress, true);
    assert.equal(marked, 0);
    assert.equal(calls.filter(x => x.includes('/media:')).length, 1);
    readiness = 'FINISHED';
    const finished = await publishImageStep('token', { ...base, state: waiting.providerState, now: 220000 }, fetcher, mark);
    assert.equal(finished.platformPostId, '67890');
    assert.equal(finished.platformPostUrl, 'https://www.instagram.com/p/example/');
    assert.equal(marked, 1);
    assert.equal(calls.filter(x => x.includes('/media_publish')).length, 1);
});

test('uncertain, failed, and already published containers never publish again', async () => {
    const base = { externalAccountId: '111', mediaType: 'image', now: 100000,
        state: { container_id: '12345', started_at: new Date(100000).toISOString() } };
    let sends = 0;
    for (const status of ['ERROR', 'EXPIRED', 'PUBLISHED', 'UNKNOWN']) {
        await assert.rejects(publishImageStep('token', base, async () => Response.json({ status_code: status }), async () => { sends++; }));
    }
    await assert.rejects(publishImageStep('token', { ...base, state: { ...base.state, submission_started: true } }, () => assert.fail('must not contact Meta')));
    assert.equal(sends, 0);
});

test('a lost authorization after the container is ready does not publish', async () => {
    let calls = 0;
    await assert.rejects(publishImageStep('token', { externalAccountId: '111', mediaType: 'image', now: 100000,
        state: { container_id: '12345', started_at: new Date(100000).toISOString() } }, async () => {
        calls++; return Response.json({ status_code: 'FINISHED' });
    }, async () => { throw new Error('claim lost'); }), /claim lost/);
    assert.equal(calls, 1);
});
