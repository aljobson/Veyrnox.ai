import { ApiError, type ApiClient } from '../src/lib/api';
import {
    cancelPost,
    captionWarning,
    composeErrorMessage,
    createBody,
    createPost,
    eligibleAccounts,
    mediaTypeOf,
    parseWhen,
    quickTimes,
    reschedulePost,
    restorePost,
    validateDraft,
    type Draft,
} from '../src/lib/publishCompose';
import type { PublishAccount } from '../src/lib/publish';

const now = new Date('2026-10-18T12:00:00Z');
const DRAFT_ID = 'aaaabbbb'; // a repeat-safe id for one draft; low entropy on purpose
const acct = (o: Partial<PublishAccount> = {}): PublishAccount => ({ id: 'a1', network: 'instagram', displayName: 'Studio', avatarUrl: null, status: 'active', connectedAt: null, tokenExpiresAt: null, publishingEnabled: true, supportedMedia: ['image', 'video'], ...o });
const draft = (o: Partial<Draft> = {}): Draft => ({ jobId: '3f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f', mediaType: 'image', accountIds: ['a1'], text: 'Hello', when: { kind: 'now' }, ...o });
const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('mediaTypeOf', () => {
    test('images and videos only', () => {
        expect(mediaTypeOf('text-to-image')).toBe('image');
        expect(mediaTypeOf('image-to-video')).toBe('video');
        expect(mediaTypeOf('text-to-audio')).toBeNull();
        expect(mediaTypeOf('chat')).toBeNull();
    });
});

describe('eligibleAccounts', () => {
    test('needs an active account, publishing on, and the media type supported', () => {
        const list = [acct(), acct({ id: 'a2', status: 'expired' }), acct({ id: 'a3', publishingEnabled: false }), acct({ id: 'a4', network: 'linkedin', supportedMedia: ['image'] })];
        expect(eligibleAccounts(list, 'video').map((a) => a.id)).toEqual(['a1']);
        expect(eligibleAccounts(list, 'image').map((a) => a.id)).toEqual(['a1', 'a4']);
    });
});

describe('captionWarning', () => {
    test('names the first network whose limit the text passes', () => {
        expect(captionWarning('x'.repeat(300), ['instagram', 'twitter'])).toMatch(/X/);
        expect(captionWarning('x'.repeat(300), ['instagram'])).toBeNull();
        expect(captionWarning('x'.repeat(300), ['unknown-network'])).toBeNull();
    });
});

describe('parseWhen', () => {
    test('reads a local date and time and rejects impossible ones', () => {
        const d = parseWhen('2026-10-20', '09:30') as Date;
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(9);
        expect(d.getDate()).toBe(20);
        expect(d.getHours()).toBe(9);
        expect(d.getMinutes()).toBe(30);
        expect(parseWhen('2026-02-31', '09:00')).toBeNull();
        expect(parseWhen('2026-10-20', '25:00')).toBeNull();
        expect(parseWhen('tomorrow', '9')).toBeNull();
    });
});

describe('quickTimes', () => {
    test('offers in an hour, tomorrow morning and next week, all in the future', () => {
        const q = quickTimes(now);
        expect(q.map((x) => x.label)).toEqual(['In 1 hour', 'Tomorrow 9:00', 'In 1 week']);
        for (const x of q) expect(x.date.getTime()).toBeGreaterThan(now.getTime() + 60_000);
        expect(q[0].date.getTime()).toBe(now.getTime() + 3_600_000);
    });
});

describe('validateDraft', () => {
    test('a good draft has no problem', () => {
        expect(validateDraft(draft(), [acct()], now)).toBeNull();
    });
    test('needs a creation, an account and not more than 4000 characters', () => {
        expect(validateDraft(draft({ jobId: '' }), [acct()], now)).toMatch(/creation/);
        expect(validateDraft(draft({ accountIds: [] }), [acct()], now)).toMatch(/account/);
        expect(validateDraft(draft({ text: 'x'.repeat(4001) }), [acct()], now)).toMatch(/4000/);
    });
    test('an account that cannot take this media is refused', () => {
        expect(validateDraft(draft({ mediaType: 'video' }), [acct({ supportedMedia: ['image'] })], now)).toMatch(/cannot post/);
    });
    test('a scheduled time must be more than a minute away', () => {
        expect(validateDraft(draft({ when: { kind: 'at', at: new Date(now.getTime() + 30_000) } }), [acct()], now)).toMatch(/future/);
        expect(validateDraft(draft({ when: { kind: 'at', at: new Date(now.getTime() + 600_000) } }), [acct()], now)).toBeNull();
    });
});

describe('createBody', () => {
    test('post now sends publishNow and no time', () => {
        expect(createBody(draft(), DRAFT_ID, now)).toEqual({ publishNow: true, globalText: 'Hello', idempotencyKey: DRAFT_ID, accountIds: ['a1'], media: [{ mediaType: 'image', jobId: '3f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f' }] });
    });
    test('a schedule sends the instant as ISO and not publishNow', () => {
        const at = new Date('2026-10-20T09:00:00Z');
        const b = createBody(draft({ when: { kind: 'at', at } }), DRAFT_ID, now) as Record<string, unknown>;
        expect(b.scheduledAt).toBe('2026-10-20T09:00:00.000Z');
        expect('publishNow' in b).toBe(false);
    });
    test('the text is trimmed', () => {
        expect((createBody(draft({ text: '  hi  ' }), DRAFT_ID, now) as { globalText: string }).globalText).toBe('hi');
    });
});

describe('requests', () => {
    test('createPost POSTs the body and reads the answer', async () => {
        const { api, request } = apiWith({ post_id: 'p1', idempotent: false, target_count: 2 });
        const r = await createPost(api, { publishNow: true });
        expect(r).toEqual({ postId: 'p1', idempotent: false, targetCount: 2 });
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/social/posts');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ publishNow: true });
    });
    test('reschedulePost sends the time and the version it saw', async () => {
        const { api, request } = apiWith({ scheduled_at: '2026-10-21T09:00:00Z', idempotent: false });
        await reschedulePost(api, 'p1', '2026-10-20T09:00:00Z', new Date('2026-10-21T09:00:00Z'));
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/social/posts/p1/schedule');
        expect(init?.method).toBe('PATCH');
        expect(JSON.parse(String(init?.body))).toEqual({ scheduledAt: '2026-10-21T09:00:00.000Z', expectedAt: '2026-10-20T09:00:00Z' });
    });
    test('cancelPost and restorePost send the action and the version', async () => {
        const a = apiWith({ updated_at: 'u2', idempotent: false });
        await cancelPost(a.api, 'p1', 'u1');
        expect(JSON.parse(String(a.request.mock.calls[0][1]?.body))).toEqual({ action: 'cancel', expectedUpdatedAt: 'u1' });
        const b = apiWith({ updated_at: 'u3', scheduled_at: '2026-10-22T09:00:00Z', idempotent: false });
        await restorePost(b.api, 'p1', 'u2', new Date('2026-10-22T09:00:00Z'));
        expect(JSON.parse(String(b.request.mock.calls[0][1]?.body))).toEqual({ action: 'restore', expectedUpdatedAt: 'u2', scheduledAt: '2026-10-22T09:00:00.000Z' });
    });
    test('the post id is encoded', async () => {
        const { api, request } = apiWith({});
        await cancelPost(api, 'a/b', 'u');
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/posts/a%2Fb');
    });
});

describe('composeErrorMessage', () => {
    const e = (status: number, code: string, body: Record<string, unknown> = {}) => composeErrorMessage(new ApiError(status, code, body));
    test('plan limits say what needs the plan', () => {
        expect(e(402, 'publish_plan_required', { feature: 'scheduling' })).toMatch(/Scheduling needs the Publish Plan/);
        expect(e(402, 'publish_plan_required', { feature: 'multiple_accounts' })).toMatch(/more than one account/);
    });
    test('a changed post asks to reload, a missing one says it is gone', () => {
        expect(e(409, 'POST_STARTED')).toMatch(/already started/);
        expect(e(409, 'SCHEDULE_CHANGED')).toMatch(/changed/);
        expect(e(404, 'POST_NOT_FOUND')).toMatch(/no longer/);
        expect(e(404, 'ACCOUNT_NOT_FOUND')).toMatch(/account/);
        expect(e(404, 'MEDIA_NOT_FOUND')).toMatch(/creation/);
    });
    test('role, calendar, rate limit, offline and the rest', () => {
        expect(e(403, 'FORBIDDEN')).toMatch(/permission/);
        expect(e(503, 'calendar_not_open')).toMatch(/not available yet/);
        expect(e(429, 'rate_limited')).toMatch(/Try again in a moment/);
        expect(e(0, 'network')).toMatch(/connection/);
        expect(composeErrorMessage(new Error('x'))).toMatch(/Nothing was posted/);
    });
});

test('over-limit variant preserves the composer message exactly', () => {
    expect(validateDraft(draft({ networkText: { twitter: '😀'.repeat(281) } }), [acct()], now)).toBe('X allows 280 characters; this is 281.');
});
