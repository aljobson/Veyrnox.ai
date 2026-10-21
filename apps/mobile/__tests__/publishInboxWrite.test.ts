import { assignThread, cleanReply, fetchMembers, replyToThread, setThreadStatus } from '../src/lib/publishInbox';
import type { ApiClient } from '../src/lib/api';

const ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function fakeApi(response: unknown = { ok: true }) {
    const calls: { path: string; init?: RequestInit }[] = [];
    const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return response; } } as unknown as ApiClient;
    return { api, calls };
}

describe('inbox replies', () => {
    test('a reply is 1 to 8000 characters after trimming', () => {
        expect(cleanReply('  Thanks! ')).toBe('Thanks!');
        expect(cleanReply('   ')).toBeNull();
        expect(cleanReply('a'.repeat(8001))).toBeNull();
    });
    test('sends the body with an idempotency key', async () => {
        const { api, calls } = fakeApi();
        await replyToThread(api, ID, 'Thanks!', 'key-12345678');
        expect(calls[0].path).toBe(`/api/v1/social/inbox/${ID}/reply`);
        expect(calls[0].init?.method).toBe('POST');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ body: 'Thanks!', idempotencyKey: 'key-12345678' });
    });
});

describe('inbox triage', () => {
    test('resolve and reopen send only the action', async () => {
        const { api, calls } = fakeApi();
        await setThreadStatus(api, ID, 'resolve');
        await setThreadStatus(api, ID, 'reopen');
        expect(calls.map((c) => JSON.parse(String(c.init?.body)))).toEqual([{ action: 'resolve' }, { action: 'reopen' }]);
        expect(calls[0].init?.method).toBe('PATCH');
    });
    test('assign names the person, unassign names nobody', async () => {
        const { api, calls } = fakeApi();
        await assignThread(api, ID, USER);
        await assignThread(api, ID, null);
        expect(calls.map((c) => JSON.parse(String(c.init?.body)))).toEqual([{ action: 'assign', userId: USER }, { action: 'unassign' }]);
    });
    test('members come from the inbox list, and junk rows are dropped', async () => {
        const { api } = fakeApi({ members: [{ user_id: USER, email: 'sam@example.com' }, { user_id: 'nope', email: 'x@example.com' }, { user_id: USER }] });
        expect(await fetchMembers(api)).toEqual([{ userId: USER, email: 'sam@example.com' }]);
    });
});
