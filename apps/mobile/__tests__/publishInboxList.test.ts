import { ApiError, type ApiClient } from '../src/lib/api';
import { defaultInboxFilter, fetchInboxListing, inboxQuery, markThreadRead, parseInboxListing, parseThreadTags, setThreadPriority, setThreadTags } from '../src/lib/publishInboxList';
import { ID, OTHER } from './publishDepthTestHelpers';
test('all filters encode validated values and invalid filters are dropped', () => {
    expect(inboxQuery({ state: 'resolved', kind: 'comment', accountId: ID, assignee: OTHER, priority: 'high', tag: 'VIP press', search: ' A & B ' })).toBe(`state=resolved&kind=comment&accountId=${ID}&assignee=${OTHER}&priority=high&tag=vip%20press&search=A%20%26%20B`);
    expect(inboxQuery({ state: 'bad', kind: 'bad', accountId: 'bad', assignee: 'bad', priority: 'bad', tag: 'bad!', search: 'x'.repeat(101) } as any)).toBe('');
    expect(inboxQuery({ ...defaultInboxFilter(), assignee: 'unassigned', tag: 'x'.repeat(33) })).toBe('state=unresolved&assignee=unassigned');
});
test('listing bounds preview and members, retains resolved counts and filters tag choices', async () => {
    const body = { threads: [{ id: ID, preview: '\u0000' + 'a'.repeat(250) }, { id: 'bad' }], counts: { all: 4, resolved: 2, unread: -1 }, members: [{ user_id: OTHER, email: 'a'.repeat(90) }, { user_id: 'bad', email: 'x' }], tags: ['vip', 'bad!', 'café', ...Array.from({ length: 60 }, (_, i) => `tag${i}`)] };
    const parsed = parseInboxListing(body);
    expect(parsed.threads).toHaveLength(1); expect(parsed.threads[0].preview).toBe('a'.repeat(200));
    expect(parsed.counts).toEqual({ all: 4, resolved: 2, unread: 0, unresolved: 0 }); expect(parsed.members).toEqual([{ userId: OTHER, email: 'a'.repeat(80) }]); expect(parsed.tags).toHaveLength(50); expect(parsed.tags).not.toContain('café');
    const request = jest.fn().mockResolvedValue(body); expect(await fetchInboxListing({ request } as unknown as ApiClient, defaultInboxFilter())).toEqual(parsed);
    expect(request).toHaveBeenCalledWith('/api/v1/social/inbox?state=unresolved');
});
test('PATCH contracts and UUID validation', async () => {
    const request = jest.fn().mockResolvedValue({}), api = { request } as unknown as ApiClient;
    await markThreadRead(api, ID); await setThreadPriority(api, ID, 'urgent'); await setThreadTags(api, ID, ['café', 'VIP']);
    expect(request.mock.calls.map(([path, init]) => [path, init.method, JSON.parse(init.body)])).toEqual([
        [`/api/v1/social/inbox/${ID}`, 'PATCH', { action: 'read' }], [`/api/v1/social/inbox/${ID}`, 'PATCH', { action: 'priority', priority: 'urgent' }], [`/api/v1/social/inbox/${ID}`, 'PATCH', { action: 'tags', tags: ['café', 'VIP'] }],
    ]);
    await expect(markThreadRead(api, 'bad')).rejects.toBeInstanceOf(ApiError); await expect(setThreadPriority(api, 'bad', 'high')).rejects.toBeInstanceOf(ApiError); await expect(setThreadTags(api, 'bad', [])).rejects.toBeInstanceOf(ApiError); expect(request).toHaveBeenCalledTimes(3);
});
test('thread tags use the Unicode write contract with UTF-16 lengths', () => {
    expect(parseThreadTags('café, VIP, vip, ,')).toEqual({ tags: ['café', 'VIP'] });
    for (const tag of ['a'.repeat(32), '😀'.repeat(16), '  ' + 'a'.repeat(32) + '  ']) expect(parseThreadTags(tag)).toEqual({ tags: [tag.trim()] });
    for (const tag of ['a'.repeat(33), '😀'.repeat(17)]) expect(parseThreadTags(tag)).toEqual({ error: 'publishOps.inbox.tagTooLong' });
    expect(parseThreadTags(Array.from({ length: 11 }, (_, i) => `tag${i}`).join(','))).toEqual({ error: 'contacts.err.tooManyTags' });
});
