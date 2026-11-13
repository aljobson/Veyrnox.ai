declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import {
    FIRST_DESTINATIONS, FIRST_PROFILE_SLOT, FIRST_ROLES, defaultAspectFor, exampleSetFor, hasRealAnswer, needsFirstRun, orderStarts, parseFirstProfile,
    phoneStarts, readRemoteFirstProfile, serializeFirstProfile,
} from '../src/lib/firstProfile';
import { fetchRemoteFirstAnswers, pushFirstAnswers } from '../src/lib/firstProfileSync';

const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'firstProfile.js'), 'utf8');

describe('the first-run answers (role, destination)', () => {
    test('list the same words, order and slot as the web', () => {
        expect(web).toContain("FIRST_ROLES = ['creator', 'business', 'pro', 'hobbyist', 'beginner']");
        expect(web).toContain("FIRST_DESTINATIONS = ['tiktok', 'reels', 'youtube', 'private']");
        expect([...FIRST_ROLES]).toEqual(['creator', 'business', 'pro', 'hobbyist', 'beginner']);
        expect([...FIRST_DESTINATIONS]).toEqual(['tiktok', 'reels', 'youtube', 'private']);
        expect(FIRST_PROFILE_SLOT).toBe('veyrnox.firstProfile.v1');
    });

    test('round-trip, and anything unreadable reads as "never chose"', () => {
        expect(parseFirstProfile(serializeFirstProfile({ role: 'creator', destination: 'skipped' }))).toEqual({ role: 'creator', destination: 'skipped' });
        for (const bad of [null, undefined, '', 'x', '[]', '{"version":2,"role":"creator"}', '{"version":1,"role":"CEO","destination":"mars"}']) {
            expect(parseFirstProfile(bad)).toEqual({ role: null, destination: null });
        }
        expect(() => serializeFirstProfile({ role: 'CEO' as never })).toThrow();
    });

    test('the server body is read as role and destination, or unavailable', () => {
        expect(readRemoteFirstProfile({ goal: 'image', role: 'pro', destination: 'reels' })).toEqual({ kind: 'profile', role: 'pro', destination: 'reels' });
        expect(readRemoteFirstProfile({ goal: null })).toEqual({ kind: 'profile', role: null, destination: null });
        expect(readRemoteFirstProfile({ role: 'astronaut' })).toEqual({ kind: 'unavailable' });
        expect(readRemoteFirstProfile(null)).toEqual({ kind: 'unavailable' });
    });

    test('the questions are for an account with no goal and no role', () => {
        expect(needsFirstRun({ goal: null, role: null })).toBe(true);
        expect(needsFirstRun({ goal: 'skipped', role: null })).toBe(false);
        expect(needsFirstRun({ goal: null, role: 'skipped' })).toBe(false);
    });

    test('start options: all kept, once; a role and a goal move one first; the phone shows create, chat and film', () => {
        for (const role of [...FIRST_ROLES, 'skipped', null]) {
            for (const goal of [null, 'image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped']) {
                expect([...orderStarts(role, goal)].sort()).toEqual(['chat', 'create', 'film', 'smart-cut']);
                expect([...phoneStarts(role, goal)].sort()).toEqual(['chat', 'create', 'film']);
            }
        }
        expect(orderStarts(null, null)).toEqual(['create', 'chat', 'film', 'smart-cut']);
        expect(phoneStarts('pro', null)[0]).toBe('film');
        expect(phoneStarts('creator', 'video')[0]).toBe('film');
        expect(phoneStarts('creator', 'edit')[0]).toBe('create');
    });

    test('orders and aspect ratios match the web tables word for word', () => {
        for (const row of ["creator: ['create', 'smart-cut', 'film', 'chat']", "business: ['create', 'film', 'chat', 'smart-cut']", "pro: ['film', 'create', 'smart-cut', 'chat']", "hobbyist: ['create', 'film', 'chat', 'smart-cut']", "beginner: ['create', 'chat', 'film', 'smart-cut']"]) {
            expect(web).toContain(row);
        }
        expect(web).toContain("{ tiktok: '9:16', reels: '9:16', youtube: '16:9' }");
        expect(defaultAspectFor('tiktok')).toBe('9:16');
        expect(defaultAspectFor('reels')).toBe('9:16');
        expect(defaultAspectFor('youtube')).toBe('16:9');
        for (const none of ['private', 'skipped', null, undefined, 'mars']) expect(defaultAspectFor(none)).toBeNull();
    });

    test('work examples for creator, business and pro only; "Suggested for you" needs a real word', () => {
        for (const r of ['creator', 'business', 'pro']) expect(exampleSetFor(r)).toBe('work');
        for (const r of ['hobbyist', 'beginner', 'skipped', null, 'x']) expect(exampleSetFor(r)).toBe('everyday');
        expect(hasRealAnswer({ role: 'skipped', destination: 'skipped', goal: 'unsure' })).toBe(false);
        expect(hasRealAnswer({ destination: 'youtube' })).toBe(true);
        expect(hasRealAnswer(null)).toBe(false);
    });
});

describe('first-run answers on the server', () => {
    test('read whole; a server from before 0499 means none; unreadable or failing is unavailable', async () => {
        const ok = { request: jest.fn(async () => ({ goal: 'edit', role: 'business', destination: null })) };
        expect(await fetchRemoteFirstAnswers(ok as never)).toEqual({ kind: 'answers', goal: 'edit', role: 'business', destination: null });
        expect(await fetchRemoteFirstAnswers({ request: async () => ({ goal: null }) } as never)).toEqual({ kind: 'answers', goal: null, role: null, destination: null });
        expect(await fetchRemoteFirstAnswers({ request: async () => ({ goal: 'image', role: 'astronaut' }) } as never)).toEqual({ kind: 'unavailable' });
        expect(await fetchRemoteFirstAnswers({ request: async () => { throw new Error('404'); } } as never)).toEqual({ kind: 'unavailable' });
    });

    test('a push sends only listed keys that are strings, nothing when empty, and never throws', async () => {
        const api = { request: jest.fn(async () => ({})) };
        await pushFirstAnswers(api as never, { role: 'pro', destination: 'youtube', extra: 'x' } as never);
        await pushFirstAnswers(api as never, {});
        expect(api.request).toHaveBeenCalledTimes(1);
        expect(api.request).toHaveBeenCalledWith('/api/v1/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"role":"pro","destination":"youtube"}' });
        await expect(pushFirstAnswers({ request: async () => { throw new Error('down'); } } as never, { role: 'pro' })).resolves.toBeUndefined();
    });
});
