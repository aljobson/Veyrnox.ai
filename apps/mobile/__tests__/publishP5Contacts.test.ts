import { ApiError, type ApiClient } from '../src/lib/api';
import { contactsErrorKey, fetchContacts, parseContacts, parseTags, saveContact, validateEdit, type Contact } from '../src/lib/publishContacts';

const c = (o: Partial<Contact> = {}): Contact => ({ accountId: 'a1', network: 'instagram', accountName: 'Studio', externalId: 'ext1', name: 'Lee', lastActiveAt: null, messages: 3, unread: 1, tags: [], status: 'unknown', notes: '', ...o });
const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => result);
    return { api: { request } as unknown as ApiClient, request };
};

describe('contacts', () => {
    test('parses rows, drops malformed ones, reads the role', () => {
        const r = parseContacts({ brandRole: 'viewer', contacts: [{ account_id: 'a1', external_id: 'e1', network: 'instagram', account_name: 'S', name: 'Lee', tags: ['vip', 5], subscription_status: 'subscribed', notes: 'hi', message_count: 4, unread_count: 1 }, { account_id: 'a1' }, 'x'] });
        expect(r.contacts).toHaveLength(1);
        expect(r.contacts[0]).toMatchObject({ tags: ['vip'], status: 'subscribed', messages: 4, unread: 1 });
        expect(r.canEdit).toBe(false);
        expect(parseContacts({ brandRole: 'editor', contacts: [] }).canEdit).toBe(true);
        expect(parseContacts({ contacts: [{ account_id: 'a', external_id: 'e', subscription_status: 'weird' }] }).contacts[0].status).toBe('unknown');
    });
    test('filters go in the query, encoded', async () => {
        const { api, request } = apiWith({ contacts: [] });
        await fetchContacts(api, { search: ' a&b ', status: 'subscribed' });
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/contacts?search=a%26b&subscriptionStatus=subscribed');
        await fetchContacts(api);
        expect(request.mock.calls[1][0]).toBe('/api/v1/social/contacts');
    });
    test('tag text is split, lowercased, de-duplicated; bad tags are reported', () => {
        expect(parseTags('VIP, press ,vip,')).toEqual({ tags: ['vip', 'press'], rejected: [] });
        expect(parseTags('ok, bad!').rejected).toEqual(['bad!']);
        expect(parseTags('x'.repeat(33)).rejected).toHaveLength(1);
    });
    test('validation', () => {
        expect(validateEdit('a, b', '')).toBeNull();
        expect(validateEdit('bad!', '')).toBe('contacts.err.tag');
        expect(validateEdit(Array.from({ length: 11 }, (_, i) => `t${i}`).join(','), '')).toBe('contacts.err.tooManyTags');
        expect(validateEdit('a', 'x'.repeat(2001))).toBe('contacts.err.notes');
    });
    test('save patches with the account and external id', async () => {
        const { api, request } = apiWith({ ok: true });
        await saveContact(api, c(), ['vip'], 'subscribed', ' note ');
        expect(request.mock.calls[0][1]?.method).toBe('PATCH');
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ accountId: 'a1', externalId: 'ext1', tags: ['vip'], subscriptionStatus: 'subscribed', notes: 'note' });
    });
    test('error keys', () => {
        expect(contactsErrorKey(new ApiError(402, 'plan_required'))).toBe('contacts.err.plan');
        expect(contactsErrorKey(new ApiError(503, 'publish_inbox_not_open'))).toBe('contacts.err.notOpen');
        expect(contactsErrorKey(new ApiError(403, 'forbidden'))).toBe('contacts.err.role');
        expect(contactsErrorKey(new ApiError(0, 'network'))).toBe('contacts.err.network');
    });
});
