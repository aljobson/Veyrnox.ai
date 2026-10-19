import { ApiError, type ApiClient } from '../src/lib/api';
import { DEFAULT_TEMPLATE, autolistErrorKey, deleteAutolist, parseAutolists, saveAutolist, templateValid, validateAutolist, type AutolistInput } from '../src/lib/publishAutolists';
import { MAX_SLOTS, deleteQueue, parseMinute, parseQueueList, queueAdminErrorKey, saveQueue, slotText, sortSlots, validateQueue, type QueueInput } from '../src/lib/publishQueueAdmin';
import { actionLabel, detailText, encodeCursor, parseActivity, parseTeam, teamErrorKey } from '../src/lib/publishTeam';

const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => result);
    return { api: { request } as unknown as ApiClient, request };
};

describe('team', () => {
    test('reads members and invitations and never an invitation link', () => {
        const t = parseTeam({ brand_name: 'Acme', actor_role: 'owner', members: [{ user_id: 'u1', email: 'a@x.test', role: 'owner', joined_at: '2026-10-01T00:00:00Z' }, { email: 'no-id@x.test' }], invitations: [{ id: 'i1', email: 'b@x.test', role: 'editor', status: 'pending', expires_at: '2026-10-30T00:00:00Z', url: 'https://example.test/secret' }] });
        expect(t.members).toHaveLength(1);
        expect(t.invitations[0]).toEqual({ id: 'i1', email: 'b@x.test', role: 'editor', status: 'pending', expiresAt: '2026-10-30T00:00:00Z' });
        expect(JSON.stringify(t)).not.toContain('secret');
    });
    test('error keys', () => {
        expect(teamErrorKey(new ApiError(403, 'FORBIDDEN'))).toBe('team.err.role');
        expect(teamErrorKey(new ApiError(404, 'teams_not_open'))).toBe('team.err.notOpen');
    });
});

describe('activity', () => {
    test('parses events and the next cursor', () => {
        const a = parseActivity({ events: [{ id: 'e1', source: 'publish', action: 'invite_member', actor_email: null, detail: { role: 'editor' }, created_at: '2026-10-19T10:00:00Z' }, { id: '', action: 'x' }], next_cursor: { created_at: '2026-10-19T10:00:00Z', id: 'e1', source: 'publish' } });
        expect(a.events).toHaveLength(1);
        expect(a.events[0].actor).toBe('System');
        expect(a.events[0].detail).toBe('{"role":"editor"}');
        expect(a.next).toEqual({ created_at: '2026-10-19T10:00:00Z', id: 'e1', source: 'publish' });
        expect(parseActivity({ events: [], history_limited: true }).limited).toBe(true);
    });
    test('detail is bounded plain text', () => {
        expect(detailText(null)).toBeNull();
        expect(detailText({})).toBeNull();
        expect(detailText('a\u0000b')).toBe('a b');
        expect(detailText('x'.repeat(500))?.length).toBe(161);
    });
    test('the cursor is base64url of its JSON, as the route reads it', () => {
        const c = { created_at: '2026-10-19T10:00:00.123456Z', id: '0b6f8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f', source: 'team' };
        const enc = encodeCursor(c);
        expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(JSON.parse(atob(enc.replace(/-/g, '+').replace(/_/g, '/')))).toEqual(c);
    });
    test('labels', () => expect(actionLabel('invite_member')).toBe('Invite member'));
});

describe('queue admin', () => {
    const q = (o: Partial<QueueInput> = {}): QueueInput => ({ id: null, name: 'Weekdays', timezone: 'Europe/London', accountIds: ['a1'], slots: [{ weekday: 1, minute: 540 }], enabled: true, ...o });
    test('parses', () => {
        expect(parseQueueList({ queues: [{ id: 'q1', name: 'N', timezone: 'UTC', account_ids: ['a'], enabled: true, slots: [{ weekday: 2, minute: 60 }] }, { id: 'x' }] })).toHaveLength(1);
    });
    test('minutes', () => {
        expect(parseMinute('09:30')).toBe(570);
        expect(parseMinute('9:05')).toBe(545);
        expect(parseMinute('24:00')).toBeNull();
        expect(parseMinute('12:60')).toBeNull();
        expect(parseMinute('noon')).toBeNull();
        expect(slotText({ weekday: 3, minute: 570 })).toBe('Wed 09:30');
        expect(sortSlots([{ weekday: 2, minute: 0 }, { weekday: 1, minute: 600 }, { weekday: 1, minute: 60 }]).map(slotText)).toEqual(['Mon 01:00', 'Mon 10:00', 'Tue 00:00']);
    });
    test('validation mirrors the route', () => {
        expect(validateQueue(q())).toBeNull();
        expect(validateQueue(q({ name: '  ' }))).toBe('queues.err.name');
        expect(validateQueue(q({ name: 'x'.repeat(81) }))).toBe('queues.err.name');
        expect(validateQueue(q({ accountIds: [] }))).toBe('queues.err.accounts');
        expect(validateQueue(q({ slots: [] }))).toBe('queues.err.slots');
        expect(validateQueue(q({ slots: Array.from({ length: MAX_SLOTS + 1 }, (_, i) => ({ weekday: 1, minute: i })) }))).toBe('queues.err.slots');
    });
    test('save sends sorted slots and trimmed name; delete encodes the id', async () => {
        const s = apiWith({ queue_id: 'q1' });
        await saveQueue(s.api, q({ name: ' Weekdays ', slots: [{ weekday: 2, minute: 0 }, { weekday: 1, minute: 0 }] }));
        expect(s.request.mock.calls[0][1]?.method).toBe('PUT');
        const body = JSON.parse(String(s.request.mock.calls[0][1]?.body));
        expect(body.name).toBe('Weekdays');
        expect(body.slots[0].weekday).toBe(1);
        const d = apiWith({ ok: true });
        await deleteQueue(d.api, 'a/b');
        expect(d.request.mock.calls[0][0]).toBe('/api/v1/social/queues?id=a%2Fb');
        expect(d.request.mock.calls[0][1]?.method).toBe('DELETE');
    });
    test('error keys', () => {
        expect(queueAdminErrorKey(new ApiError(409, 'queue_name_taken'))).toBe('queues.err.taken');
        expect(queueAdminErrorKey(new ApiError(409, 'queue_limit'))).toBe('queues.err.limit');
        expect(queueAdminErrorKey(new ApiError(404, 'queues_not_open'))).toBe('queues.err.notOpen');
        expect(queueAdminErrorKey(new ApiError(0, 'network'))).toBe('queues.err.network');
    });
});

describe('autolists', () => {
    const a = (o: Partial<AutolistInput> = {}): AutolistInput => ({ id: null, queueId: 'q1', name: 'Blog', feedUrl: 'https://example.test/feed.xml', captionTemplate: DEFAULT_TEMPLATE, refreshIntervalMinutes: 360, enabled: true, autoSchedule: false, ...o });
    test('template placeholders', () => {
        expect(templateValid('{{title}} {{link}} {{summary}}')).toBe(true);
        expect(templateValid('{{author}}')).toBe(false);
        expect(templateValid('  ')).toBe(false);
        expect(templateValid('x'.repeat(4001))).toBe(false);
    });
    test('validation', () => {
        expect(validateAutolist(a())).toBeNull();
        expect(validateAutolist(a({ feedUrl: 'http://example.test/feed' }))).toBe('autolists.err.feed');
        expect(validateAutolist(a({ feedUrl: 'https://' }))).toBe('autolists.err.feed');
        expect(validateAutolist(a({ name: '' }))).toBe('autolists.err.name');
        expect(validateAutolist(a({ queueId: '' }))).toBe('autolists.err.queue');
        expect(validateAutolist(a({ refreshIntervalMinutes: 7 }))).toBe('autolists.err.interval');
    });
    test('parse, save and delete', async () => {
        const list = parseAutolists({ autolists: [{ id: 'a1', queue_id: 'q1', queue_name: 'Q', name: 'Blog', feed_url: 'https://e.test/f', caption_template: '{{title}}', refresh_interval_minutes: 60, enabled: true, auto_schedule: false, last_error: null, items: [{ id: 'i1', title: 'T', status: 'new' }] }, { id: 'bad' }] });
        expect(list).toHaveLength(1);
        expect(list[0].items[0].title).toBe('T');
        const s = apiWith({ autolist_id: 'a1' });
        await saveAutolist(s.api, a({ name: ' Blog ' }));
        expect(JSON.parse(String(s.request.mock.calls[0][1]?.body)).name).toBe('Blog');
        const d = apiWith({ ok: true });
        await deleteAutolist(d.api, 'a1');
        expect(d.request.mock.calls[0][0]).toBe('/api/v1/social/autolists?id=a1');
    });
    test('error keys', () => {
        expect(autolistErrorKey(new ApiError(409, 'autolist_name_taken'))).toBe('autolists.err.taken');
        expect(autolistErrorKey(new ApiError(404, 'autolists_not_open'))).toBe('autolists.err.notOpen');
        expect(autolistErrorKey(new ApiError(400, 'invalid_body'))).toBe('autolists.err.invalid');
    });
});
