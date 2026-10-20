import { ApiError } from '../src/lib/api';
import { fetchInbox, fetchThread, inboxErrorKey, parseInbox, parseThreadView } from '../src/lib/publishInbox';
import type { ApiClient } from '../src/lib/api';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';
const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string) => result);
    return { api: { request } as unknown as ApiClient, request };
};

describe('inbox', () => {
    test('parses threads, drops rows without a real id, reads counts', () => {
        const r = parseInbox({ counts: { all: 5, unread: 2, unresolved: 3 }, threads: [{ id: ID, network: 'instagram', account_name: 'S', kind: 'comment', participant_name: 'Lee', subject: 'Hi', unread_count: 2, tags: ['vip', 3], priority: 'high' }, { id: 'nope' }, 'x'] });
        expect(r.counts).toEqual({ all: 5, unread: 2, unresolved: 3 });
        expect(r.threads).toHaveLength(1);
        expect(r.threads[0]).toMatchObject({ kind: 'comment', unread: 2, tags: ['vip'], priority: 'high' });
        expect(parseInbox(null)).toEqual({ threads: [], counts: { all: 0, unread: 0, unresolved: 0 } });
    });
    test('names and text are bounded and stripped of control characters', () => {
        const r = parseInbox({ threads: [{ id: ID, participant_name: `a\u0000b${'x'.repeat(200)}` }] });
        expect(r.threads[0].name).not.toContain('\u0000');
        expect(r.threads[0].name.length).toBeLessThanOrEqual(81);
        const v = parseThreadView({ thread: { id: ID }, messages: [{ id: 'm1', direction: 'inbound', body: 'y'.repeat(5000) }] });
        expect(v.messages[0].body.length).toBe(2001);
    });
    test('reads direction, attachments and notes; links are not kept', () => {
        const v = parseThreadView({ thread: { id: ID, can_reply: true, provider_url: 'https://evil.test' }, messages: [{ id: 'm1', direction: 'outbound', body: 'ok', media: [{ url: 'https://x.test/a.jpg' }], delivery_status: 'sent' }, { body: 'no id' }], notes: [{ id: 'n1', body: 'call back', actor_email: 'a@x.test' }] });
        expect(v.canReply).toBe(true);
        expect(v.messages).toHaveLength(1);
        expect(v.messages[0]).toMatchObject({ outgoing: true, hasMedia: true });
        expect(v.notes[0].author).toBe('a@x.test');
        expect(JSON.stringify(v)).not.toContain('evil.test');
        expect(JSON.stringify(v)).not.toContain('a.jpg');
    });
    test('requests carry the filters, encoded', async () => {
        const { api, request } = apiWith({ threads: [] });
        await fetchInbox(api, 'unread', 'comment');
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/inbox?state=unread&kind=comment');
        await fetchInbox(api, 'all', null);
        expect(request.mock.calls[1][0]).toBe('/api/v1/social/inbox?state=all');
        await fetchThread(api, ID);
        expect(request.mock.calls[2][0]).toBe(`/api/v1/social/inbox/${ID}`);
        await expect(fetchThread(api, '../x')).rejects.toBeInstanceOf(ApiError);
    });
    test('error keys', () => {
        expect(inboxErrorKey(new ApiError(402, 'plan_required'))).toBe('inbox.err.plan');
        expect(inboxErrorKey(new ApiError(503, 'publish_inbox_not_open'))).toBe('inbox.err.notOpen');
        expect(inboxErrorKey(new ApiError(0, 'network'))).toBe('inbox.err.network');
    });
});
