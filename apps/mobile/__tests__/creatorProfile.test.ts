import { ApiError } from '../src/lib/api';
import type { CreatorAnswers } from '../src/lib/creatorAnswers';
import { fetchVibe, parseVibe, resetVibe, saveVibe, serializeVibe, shouldOfferVibe, skipVibe, syncVibe, type StoredVibe } from '../src/lib/creatorProfile';

const answers: CreatorAnswers = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };
const completed: StoredVibe = { version: 1, state: 'completed', answers, synced: false };

function api(handler: (path: string, init?: RequestInit) => unknown) {
    const calls: { path: string; init?: RequestInit }[] = [];
    return {
        calls,
        request: async <T>(path: string, init?: RequestInit): Promise<T> => {
            calls.push({ path, init });
            const out = handler(path, init);
            if (out instanceof Error) throw out;
            return out as T;
        },
    };
}

describe('what the phone remembers', () => {
    test('a completed choice round-trips; a skip keeps no answers', () => {
        expect(parseVibe(serializeVibe(completed))).toEqual(completed);
        const skipped = parseVibe(serializeVibe({ state: 'skipped', answers, synced: true }));
        expect(skipped).toEqual({ version: 1, state: 'skipped', answers: null, synced: true });
    });

    test.each([
        [null], [undefined], [''], ['not json'], ['[]'], ['null'],
        [JSON.stringify({ version: 2, state: 'skipped' })],
        [JSON.stringify({ version: 1, state: 'completed', answers: { ...answers, look: 'sepia' } })],
        [JSON.stringify({ version: 1, state: 'completed' })],
        [JSON.stringify({ version: 1, state: 'other' })],
    ])('unreadable or half-formed reads as "never chose": %p', (raw) => {
        expect(parseVibe(raw as string | null | undefined)).toBeNull();
    });

    test('the interview is offered only to someone who has not chosen, and only when the build ships it', () => {
        expect(shouldOfferVibe(null, true)).toBe(true);
        expect(shouldOfferVibe(null, false)).toBe(false);
        expect(shouldOfferVibe(completed, true)).toBe(false);
        expect(shouldOfferVibe({ version: 1, state: 'skipped', answers: null, synced: true }, true)).toBe(false);
    });
});

describe('the server calls', () => {
    test('save sends the answers as JSON with PUT', async () => {
        const a = api(() => ({ status: 'completed' }));
        expect(await saveVibe(a, answers)).toEqual({ kind: 'ok' });
        expect(a.calls[0].path).toBe('/api/v1/creator-profile');
        expect(a.calls[0].init?.method).toBe('PUT');
        expect(JSON.parse(String(a.calls[0].init?.body))).toEqual(answers);
    });

    test('skip and reset use their own verbs', async () => {
        const a = api(() => ({}));
        await skipVibe(a);
        await resetVibe(a);
        expect(a.calls.map((c) => [c.path, c.init?.method])).toEqual([['/api/v1/creator-profile/skip', 'POST'], ['/api/v1/creator-profile', 'DELETE']]);
    });

    test('a 404 (server flag off) is "unavailable"; any other failure is "failed"', async () => {
        expect(await saveVibe(api(() => new ApiError(404, 'not_found')), answers)).toEqual({ kind: 'unavailable' });
        expect(await skipVibe(api(() => new ApiError(502, 'creator_profile_unavailable')), )).toEqual({ kind: 'failed' });
        expect(await resetVibe(api(() => new Error('offline')))).toEqual({ kind: 'failed' });
    });

    test('reading the server copy: none, skipped, completed, and junk', async () => {
        expect(await fetchVibe(api(() => ({ status: 'none' })))).toBeNull();
        expect(await fetchVibe(api(() => ({ status: 'skipped', answers: {} })))).toEqual({ version: 1, state: 'skipped', answers: null, synced: true });
        expect(await fetchVibe(api(() => ({ status: 'completed', answers })))).toEqual({ version: 1, state: 'completed', answers, synced: true });
        expect(await fetchVibe(api(() => ({ status: 'completed', answers: { look: 'sepia' } })))).toBeNull();
        expect(await fetchVibe(api(() => new ApiError(404, 'not_found')))).toBeNull();
    });

    test('sync sends an unsynced choice once and leaves a failure unsynced', async () => {
        const ok = api(() => ({}));
        expect(await syncVibe(ok, completed)).toEqual({ ...completed, synced: true });
        expect(ok.calls[0].init?.method).toBe('PUT');
        const skipped = await syncVibe(ok, { version: 1, state: 'skipped', answers: null, synced: false });
        expect(skipped.synced).toBe(true);
        expect(ok.calls[1].path).toBe('/api/v1/creator-profile/skip');
        const synced = api(() => ({}));
        expect(await syncVibe(synced, { ...completed, synced: true })).toEqual({ ...completed, synced: true });
        expect(synced.calls).toHaveLength(0);
        expect((await syncVibe(api(() => new Error('down')), completed)).synced).toBe(false);
    });
});
