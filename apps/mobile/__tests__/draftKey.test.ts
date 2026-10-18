import { ApiError } from '../src/lib/api';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { createDraftKeys, draftSignature, isDefiniteRefusal } from '../src/lib/draftKey';
import type { Draft } from '../src/lib/publishCompose';

const draft = (o: Partial<Draft> = {}): Draft => ({ jobId: 'job-1', mediaType: 'image', accountIds: ['a1'], text: 'Hello', when: { kind: 'now' }, ...o });
const HOUR = 3_600_000;

function setup() {
    const storage = createMemoryStorage();
    let now = 1_000_000;
    let n = 0;
    const keys = createDraftKeys(storage, () => now, () => `uuid-${++n}-xxxxxxxx`);
    return { storage, keys, advance: (ms: number) => void (now += ms) };
}

describe('draftSignature', () => {
    test('is the same for the same draft and differs when anything that is posted differs', () => {
        expect(draftSignature(draft())).toBe(draftSignature(draft()));
        expect(draftSignature(draft({ text: 'Other' }))).not.toBe(draftSignature(draft()));
        expect(draftSignature(draft({ accountIds: ['a2'] }))).not.toBe(draftSignature(draft()));
        expect(draftSignature(draft({ jobId: 'job-2' }))).not.toBe(draftSignature(draft()));
        expect(draftSignature(draft({ when: { kind: 'at', at: new Date('2026-10-20T09:00:00Z') } }))).not.toBe(draftSignature(draft()));
    });
    test('ignores the order accounts were chosen in', () => {
        expect(draftSignature(draft({ accountIds: ['a1', 'a2'] }))).toBe(draftSignature(draft({ accountIds: ['a2', 'a1'] })));
    });
});

describe('createDraftKeys', () => {
    test('gives the same key for the same draft, and a different key for a different draft', async () => {
        const { keys } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        expect(await keys.keyFor('u1', draftSignature(draft()))).toBe(a);
        expect(await keys.keyFor('u1', draftSignature(draft({ text: 'Other' })))).not.toBe(a);
    });

    test('survives a simulated restart: a new instance over the same storage returns the same key', async () => {
        const { storage, keys } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        const afterRestart = createDraftKeys(storage, () => 1_000_500, () => 'would-be-new-key');
        expect(await afterRestart.keyFor('u1', draftSignature(draft()))).toBe(a);
    });

    test('is dropped after a success, so the next post is a new post', async () => {
        const { keys } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        await keys.drop('u1');
        expect(await keys.keyFor('u1', draftSignature(draft()))).not.toBe(a);
    });

    test('expires after 24 hours', async () => {
        const { keys, advance } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        advance(23 * HOUR);
        expect(await keys.keyFor('u1', draftSignature(draft()))).toBe(a);
        advance(2 * HOUR);
        expect(await keys.keyFor('u1', draftSignature(draft()))).not.toBe(a);
    });

    test('is kept per person', async () => {
        const { keys } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        expect(await keys.keyFor('u2', draftSignature(draft()))).not.toBe(a);
        expect(await keys.keyFor('u1', draftSignature(draft()))).not.toBe(await keys.keyFor('u2', draftSignature(draft())));
    });

    test('is removed by the cache wipe that runs on sign-out and user change', async () => {
        const { storage, keys } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        await createCache(storage).clear();
        expect(await keys.keyFor('u1', draftSignature(draft()))).not.toBe(a);
    });

    test('a damaged or unreadable saved record gives a fresh key instead of failing', async () => {
        const { storage, keys } = setup();
        const a = await keys.keyFor('u1', draftSignature(draft()));
        const name = (await storage.keys())[0];
        await storage.set(name, '{not json');
        expect(await keys.keyFor('u1', draftSignature(draft()))).not.toBe(a);
    });

    test('without a user, or when storage fails, it still returns a usable key for this attempt', async () => {
        const { keys } = setup();
        expect(await keys.keyFor(undefined, 'sig')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
        const broken = createDraftKeys({ get: async () => { throw new Error('disk'); }, set: async () => { throw new Error('disk'); }, remove: async () => { throw new Error('disk'); }, keys: async () => [] }, Date.now, () => 'fallback-key-1');
        expect(await broken.keyFor('u1', 'sig')).toBe('fallback-key-1');
        await expect(broken.drop('u1')).resolves.toBeUndefined();
    });

    test('every key satisfies the server rule 8 to 128 characters of letters, digits, _ and -', async () => {
        const { keys } = setup();
        expect(await keys.keyFor('u1', 'sig')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    });
});

describe('isDefiniteRefusal', () => {
    test('a 4xx the server decided on is final, so the key is dropped', () => {
        expect(isDefiniteRefusal(new ApiError(400, 'invalid_media'))).toBe(true);
        expect(isDefiniteRefusal(new ApiError(402, 'publish_plan_required'))).toBe(true);
        expect(isDefiniteRefusal(new ApiError(404, 'ACCOUNT_NOT_FOUND'))).toBe(true);
    });
    test('a network error, a timeout, a rate limit and any 5xx are not final: the key is kept', () => {
        expect(isDefiniteRefusal(new ApiError(0, 'network'))).toBe(false);
        expect(isDefiniteRefusal(new ApiError(408, 'timeout'))).toBe(false);
        expect(isDefiniteRefusal(new ApiError(429, 'rate_limited'))).toBe(false);
        expect(isDefiniteRefusal(new ApiError(502, 'internal'))).toBe(false);
        expect(isDefiniteRefusal(new Error('x'))).toBe(false);
    });
});
