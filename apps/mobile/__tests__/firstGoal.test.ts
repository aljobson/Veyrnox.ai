declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import { FIRST_GOALS, FIRST_GOAL_EXAMPLES, FIRST_GOAL_SLOT, firstGoalTarget, parseFirstGoal, readRemoteFirstGoal, serializeFirstGoal } from '../src/lib/firstGoal';
import { fetchRemoteFirstGoal, pushFirstGoal } from '../src/lib/firstGoalSync';

describe('the first-goal question', () => {
    test('covers every creation area plus "not sure"', () => {
        expect([...FIRST_GOALS]).toEqual(['image', 'video', 'audio', 'edit', 'publish', 'unsure']);
    });

    test('lists the same goals, in the same order, as the web card', () => {
        const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'firstGoal.js'), 'utf8');
        const ids = [...web.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
        expect(ids).toEqual([...FIRST_GOALS]);
        expect(web).toMatch(/FIRST_GOAL_EXAMPLES = \['image', 'video', 'audio'\]/);
        expect(web).toContain(`veyrnox.firstGoal.v`);
        expect(FIRST_GOAL_SLOT).toBe('veyrnox.firstGoal.v1');
    });

    test('creation goals open the starter form, Edit and Publish go to their tabs, "not sure" stays', () => {
        expect(firstGoalTarget('image')).toEqual({ kind: 'create', goal: 'image' });
        expect(firstGoalTarget('video')).toEqual({ kind: 'create', goal: 'video' });
        expect(firstGoalTarget('audio')).toEqual({ kind: 'create', goal: 'audio' });
        expect(firstGoalTarget('edit')).toEqual({ kind: 'tab', href: '/editor' });
        expect(firstGoalTarget('publish')).toEqual({ kind: 'tab', href: '/publish' });
        expect(firstGoalTarget('unsure')).toEqual({ kind: 'stay' });
        expect(firstGoalTarget('nonsense')).toEqual({ kind: 'stay' });
    });

    test('the stored choice is versioned and anything unreadable reads as "never chose"', () => {
        expect(parseFirstGoal(serializeFirstGoal('audio'))).toBe('audio');
        expect(parseFirstGoal(serializeFirstGoal('skipped'))).toBe('skipped');
        for (const bad of [null, undefined, '', '{', '[]', '{"version":2,"goal":"audio"}', '{"version":1,"goal":"rm -rf"}', '{"version":1}']) {
            expect(parseFirstGoal(bad)).toBeNull();
        }
    });

    test('the storage name uses only the characters the file cache allows', () => {
        expect(FIRST_GOAL_SLOT).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    test('an unknown goal is refused instead of stored', () => {
        expect(() => serializeFirstGoal('rm -rf' as never)).toThrow('unknown first goal');
    });

    test('"not sure" offers one example for each creation area', () => {
        expect([...FIRST_GOAL_EXAMPLES]).toEqual(['image', 'video', 'audio']);
        for (const goal of FIRST_GOAL_EXAMPLES) expect(firstGoalTarget(goal)).toEqual({ kind: 'create', goal });
    });

    test('the server reply is read strictly: a listed word, none yet, or unavailable', () => {
        for (const goal of [...FIRST_GOALS, 'skipped']) expect(readRemoteFirstGoal({ goal })).toEqual({ kind: 'goal', goal });
        expect(readRemoteFirstGoal({ goal: null })).toEqual({ kind: 'none' });
        for (const bad of [null, undefined, 'image', [], {}, { goal: 7 }, { goal: 'rm -rf' }, { goal: ['image'] }]) {
            expect(readRemoteFirstGoal(bad)).toEqual({ kind: 'unavailable' });
        }
    });

    test('sync never throws: failures read as unavailable and a failed push is swallowed', async () => {
        const ok = { request: jest.fn(async () => ({ goal: 'video' })) };
        expect(await fetchRemoteFirstGoal(ok as never)).toEqual({ kind: 'goal', goal: 'video' });
        expect(ok.request).toHaveBeenCalledWith('/api/v1/first-goal');
        await pushFirstGoal(ok as never, 'image');
        expect(ok.request).toHaveBeenLastCalledWith('/api/v1/first-goal', expect.objectContaining({ method: 'PUT', body: '{"goal":"image"}' }));
        const down = { request: jest.fn(async () => { throw new Error('offline'); }) };
        expect(await fetchRemoteFirstGoal(down as never)).toEqual({ kind: 'unavailable' });
        await expect(pushFirstGoal(down as never, 'image')).resolves.toBeUndefined();
    });
});

const mockSecure = new Map<string, string>();
const mockCache = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockSecure.set(k, v); },
}));
jest.mock('../src/lib/appCache', () => ({
    appStorage: { get: async (k: string) => mockCache.get(k) ?? null, set: async (k: string, v: string) => { mockCache.set(k, v); } },
}));

describe('a home start option is the answer', () => {
    const { HOME_START_GOALS, homeStartGoal } = require('../src/lib/firstGoal');
    const store = require('../src/lib/firstGoalStore');

    test('Film is video, Smart Cut is edit, Create and Chat name no area; same table as the web', () => {
        expect(HOME_START_GOALS).toEqual({ create: 'skipped', chat: 'skipped', film: 'video', 'smart-cut': 'edit' });
        expect(homeStartGoal('film')).toBe('video');
        expect(homeStartGoal('nonsense')).toBeNull();
        const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'firstGoal.js'), 'utf8');
        expect(web).toContain("HOME_START_GOALS = { create: 'skipped', chat: 'skipped', film: 'video', 'smart-cut': 'edit' }");
    });

    test('a tap stores and pushes the goal once, and keeps an answer already held', async () => {
        const request = jest.fn(async () => ({}));
        expect(store.homeStartRecorded()).toBe(false);
        await store.recordHomeStart({ request }, 'film');
        expect(await store.readFirstGoal()).toBe('video');
        expect(request).toHaveBeenCalledWith('/api/v1/first-goal', expect.objectContaining({ method: 'PUT', body: '{"goal":"video"}' }));
        expect(store.homeStartRecorded()).toBe(true);
        request.mockClear();
        await store.recordHomeStart({ request }, 'create');
        expect(await store.readFirstGoal()).toBe('video');
        expect(request).not.toHaveBeenCalled();
        await store.recordHomeStart({ request }, 'unknown');
        expect(request).not.toHaveBeenCalled();
    });
});
