import { ApiError, type ApiClient } from '../src/lib/api';
import { disconnectAccount, disconnectErrorKey } from '../src/lib/publishAccounts';
import { cleanNetworkText, composeErrorMessage, createBody, validateDraft, type Draft } from '../src/lib/publishCompose';
import { draftSignature } from '../src/lib/draftKey';
import { confirmSlot, parseQueues, queueErrorKey, reserveSlot, slotLabel } from '../src/lib/publishQueues';
import type { PublishAccount } from '../src/lib/publish';

const acct = (o: Partial<PublishAccount> = {}): PublishAccount => ({ id: 'a1', network: 'instagram', displayName: 'Studio', avatarUrl: null, status: 'active', connectedAt: null, tokenExpiresAt: null, publishingEnabled: true, supportedMedia: ['image', 'video'], ...o });
const draft = (o: Partial<Draft> = {}): Draft => ({ jobId: 'job-1', mediaType: 'video', accountIds: ['a1'], text: 'Hello', when: { kind: 'now' }, ...o });
const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};
const now = new Date('2026-10-19T12:00:00Z');

describe('per-network text and YouTube visibility', () => {
    test('cleanNetworkText keeps non-empty text for chosen networks only', () => {
        expect(cleanNetworkText({ instagram: 'ig', twitter: '  ', linkedin: 'li' }, ['instagram', 'twitter'])).toEqual({ instagram: 'ig' });
    });

    test('createBody sends networkText and youtubeVisibility only when set', () => {
        expect(createBody(draft(), 'aaaabbbb', now)).not.toHaveProperty('networkText');
        expect(createBody(draft({ networkText: {} }), 'aaaabbbb', now)).not.toHaveProperty('networkText');
        const body = createBody(draft({ networkText: { instagram: 'ig text' }, youtubeVisibility: 'unlisted' }), 'aaaabbbb', now);
        expect(body.networkText).toEqual({ instagram: 'ig text' });
        expect(body.youtubeVisibility).toBe('unlisted');
    });

    test('a variant over its network limit is refused before sending', () => {
        const d = draft({ networkText: { twitter: 'x'.repeat(281) } });
        expect(validateDraft(d, [acct({ id: 'a1', network: 'twitter' })], now)).toMatch(/280/);
        expect(validateDraft(draft({ networkText: { twitter: 'x'.repeat(280) } }), [acct({ network: 'twitter' })], now)).toBeNull();
    });

    test('a queue draft skips the time check', () => {
        const d = draft({ queue: { id: 'q1', name: 'Weekdays' } });
        expect(validateDraft(d, [acct()], now)).toBeNull();
    });

    test('server codes for variants and visibility have plain messages', () => {
        expect(composeErrorMessage(new ApiError(404, 'variants_not_open'))).toMatch(/not open/);
        expect(composeErrorMessage(new ApiError(503, 'youtube_visibility_not_open'))).toMatch(/not open/);
        expect(composeErrorMessage(new ApiError(402, 'publish_plan_required', { feature: 'platform_variants' }))).toMatch(/Publish Plan/);
        expect(composeErrorMessage(new ApiError(400, 'caption_too_long'))).toMatch(/too long/);
    });

    test('the draft key changes when the network text, visibility or queue changes', () => {
        const base = draftSignature(draft());
        expect(draftSignature(draft({ networkText: { instagram: 'a' } }))).not.toBe(base);
        expect(draftSignature(draft({ youtubeVisibility: 'public' }))).not.toBe(base);
        expect(draftSignature(draft({ queue: { id: 'q1', name: 'n' } }))).not.toBe(base);
        expect(draftSignature(draft({ networkText: { b: '1', a: '2' } }))).toBe(draftSignature(draft({ networkText: { a: '2', b: '1' } })));
    });
});

describe('queues', () => {
    test('parses queues and drops malformed rows', () => {
        const q = parseQueues({ queues: [{ id: 'q1', name: 'Weekdays', timezone: 'Europe/London', account_ids: ['a1'], enabled: true, slots: [{ weekday: 1, minute: 540 }, { weekday: 'x' }] }, { id: '', name: 'bad' }, 'junk'] });
        expect(q).toEqual([{ id: 'q1', name: 'Weekdays', timezone: 'Europe/London', accountIds: ['a1'], enabled: true, slots: [{ weekday: 1, minute: 540 }] }]);
        expect(parseQueues(null)).toEqual([]);
    });

    test('slotLabel names the weekday and time', () => {
        expect(slotLabel({ weekday: 1, minute: 540 })).toBe('Mon 09:00');
        expect(slotLabel({ weekday: 7, minute: 1439 })).toBe('Sun 23:59');
    });

    test('reserveSlot posts the queue and key, and reads the reservation', async () => {
        const { api, request } = apiWith({ assignment_id: 'as1', scheduled_at: '2026-10-20T09:00:00Z', account_ids: ['a1'] });
        const r = await reserveSlot(api, 'q1', 'aaaabbbb');
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/queues/reserve');
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ queueId: 'q1', idempotencyKey: 'aaaabbbb' });
        expect(r.assignmentId).toBe('as1');
        expect(r.scheduledAt.toISOString()).toBe('2026-10-20T09:00:00.000Z');
        expect(r.accountIds).toEqual(['a1']);
    });

    test('a reservation without a time is refused', async () => {
        await expect(reserveSlot(apiWith({ assignment_id: 'as1' }).api, 'q1', 'aaaabbbb')).rejects.toThrow();
    });

    test('confirmSlot patches the assignment and post', async () => {
        const { api, request } = apiWith({ ok: true });
        await confirmSlot(api, 'as1', 'p1');
        expect(request.mock.calls[0][1]?.method).toBe('PATCH');
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ assignmentId: 'as1', postId: 'p1' });
    });

    test('queue errors map to messages', () => {
        expect(queueErrorKey(new ApiError(404, 'queues_not_open'))).toBe('queue.err.notOpen');
        expect(queueErrorKey(new ApiError(409, 'no_queue_slot'))).toBe('queue.err.noSlot');
        expect(queueErrorKey(new ApiError(402, 'plan_required'))).toBe('queue.err.plan');
        expect(queueErrorKey(new ApiError(502, 'internal'))).toBe('queue.err.later');
    });
});

describe('disconnectAccount', () => {
    test('sends DELETE for the account id, encoded', async () => {
        const { api, request } = apiWith({ ok: true });
        await disconnectAccount(api, 'a/1');
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/accounts/a%2F1');
        expect(request.mock.calls[0][1]?.method).toBe('DELETE');
    });

    test('errors map to messages', () => {
        expect(disconnectErrorKey(new ApiError(404, 'not_found'))).toBe('accounts.err.gone');
        expect(disconnectErrorKey(new ApiError(0, 'network'))).toBe('accounts.err.network');
        expect(disconnectErrorKey(new ApiError(502, 'internal'))).toBe('accounts.err.later');
    });
});
