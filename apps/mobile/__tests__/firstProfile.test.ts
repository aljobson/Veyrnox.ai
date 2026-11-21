declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import {
    FIRST_DESTINATIONS, FIRST_PROFILE_SLOT, FIRST_ROLES, defaultAspectFor, exampleSetFor, hasRealAnswer, needsFirstRun, orderStarts, parseFirstProfile,
    parseFirstOnboarding, phoneStarts, readRemoteFirstOnboarding, readRemoteFirstProfile, serializeFirstOnboarding, serializeFirstProfile,
} from '../src/lib/firstProfile';
import { fetchRemoteFirstAnswers, pushFirstAnswers, pushFirstOnboarding } from '../src/lib/firstProfileSync';
import { replayFirstOnboarding } from '../src/lib/firstProfileStore';

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

    test('progress is strict and the offline envelope belongs to one account', () => {
        expect(readRemoteFirstOnboarding({ version: 1, current_step: 'role', completed: false })).toEqual({ version: 1, currentStep: 'role', completed: false });
        expect(readRemoteFirstOnboarding({ version: 1, current_step: null, completed: false })).toBeNull();
        const raw = serializeFirstOnboarding('A', { goal: 'video', role: null, destination: 'youtube', version: 1, currentStep: 'role', completed: false });
        expect(parseFirstOnboarding(raw, 'A')).toEqual({ goal: 'video', role: null, destination: 'youtube', version: 1, currentStep: 'role', completed: false });
        expect(parseFirstOnboarding(raw, 'B')).toBeNull();
        expect(parseFirstOnboarding('{"owner":"A","version":1,"goal":"private prompt","role":null,"destination":null,"currentStep":"destination","completed":false}', 'A')).toBeNull();
        expect(parseFirstOnboarding(serializeFirstOnboarding('A', { goal: 'video', role: 'creator', destination: 'youtube', version: 1,
            currentStep: 'recap', completed: false, pending: true, completeRequested: true }), 'A')).toEqual({
            goal: 'video', role: 'creator', destination: 'youtube', version: 1, currentStep: 'recap', completed: false,
            pending: true, completeRequested: true,
        });
    });

    test('the questions are for an account with no goal and no role', () => {
        expect(needsFirstRun({ goal: null, role: null })).toBe(true);
        expect(needsFirstRun({ goal: 'skipped', role: null })).toBe(false);
        expect(needsFirstRun({ goal: null, role: 'skipped' })).toBe(false);
        expect(needsFirstRun({ goal: 'video', role: null, completed: false })).toBe(true);
        expect(needsFirstRun({ goal: null, role: null, completed: true })).toBe(false);
    });

    test('start options: all kept, once; a role and a goal move one first; the phone shows create, audio, chat and film', () => {
        for (const role of [...FIRST_ROLES, 'skipped', null]) {
            for (const goal of [null, 'image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped']) {
                expect([...orderStarts(role, goal)].sort()).toEqual(['audio', 'chat', 'create', 'film', 'smart-cut']);
                expect([...phoneStarts(role, goal)].sort()).toEqual(['audio', 'chat', 'create']); // Film Studio is hidden (ADR-0344)
            }
        }
        for (const role of [...FIRST_ROLES, null]) expect(orderStarts(role, 'audio')[0]).toBe('audio');
        expect(orderStarts(null, null)).toEqual(['create', 'audio', 'chat', 'film', 'smart-cut']);
        expect(phoneStarts('pro', null)[0]).toBe('create');
        expect(phoneStarts('creator', 'video')).not.toContain('film');
        expect(phoneStarts('creator', 'edit')[0]).toBe('create');
    });

    test('orders and aspect ratios match the web tables word for word', () => {
        for (const row of ["creator: ['create', 'audio', 'smart-cut', 'film', 'chat']", "business: ['create', 'film', 'audio', 'chat', 'smart-cut']", "pro: ['film', 'create', 'audio', 'smart-cut', 'chat']", "hobbyist: ['create', 'audio', 'film', 'chat', 'smart-cut']", "beginner: ['create', 'audio', 'chat', 'film', 'smart-cut']"]) {
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

    test('a versioned push is fenced to its captured account task', async () => {
        const api = { request: jest.fn(async () => ({ version: 1, current_step: 'destination', completed: false })) };
        const task = { gen: 1, user: 'A', current: () => true };
        await pushFirstOnboarding(api as never, task, { currentStep: 'goal', answer: 'video' });
        expect(api.request).toHaveBeenCalledWith('/api/v1/first-goal', expect.objectContaining({ body: '{"version":1,"current_step":"goal","completed":false,"goal":"video"}' }), { task, owner: 'A', timeoutMs: 5000 });
        const stale = { ...task, current: () => false };
        await pushFirstOnboarding(api as never, stale, { currentStep: 'goal', answer: 'audio' });
        expect(api.request).toHaveBeenCalledTimes(1);
    });

    test('the mobile outbox stays incomplete on failure, reconciles 409, and replays canonically on relaunch', async () => {
        const task = { gen: 1, user: 'A', current: () => true };
        const desired = { goal: 'video' as const, destination: 'youtube' as const, role: 'creator' as const, version: 1 as const,
            currentStep: 'recap' as const, completed: false, pending: true, completeRequested: true };
        const down = { request: jest.fn(async () => { throw new Error('offline'); }) };
        const failed = await replayFirstOnboarding(down as never, task, desired);
        expect(failed).toEqual(expect.objectContaining({ completed: false, pending: true }));

        const order: string[] = [];
        const success = { request: jest.fn(async (_path: string, init?: RequestInit) => {
            if (!init?.method) return { goal: 'video', destination: 'youtube', role: 'creator', version: 1, current_step: null, completed: true };
            order.push(JSON.parse(init.body as string).current_step);
            return { ok: true };
        }) };
        const settled = await replayFirstOnboarding(success as never, task, failed!);
        expect(order).toEqual(['goal', 'destination', 'role', 'recap']);
        expect(settled).toEqual(expect.objectContaining({ completed: true }));
        expect(settled?.pending).toBeUndefined();

        const conflict = { request: jest.fn(async (_path: string, init?: RequestInit) => {
            if (!init?.method) return { goal: 'video', destination: 'youtube', role: 'creator', version: 1, current_step: 'recap', completed: false };
            if (JSON.parse(init.body as string).current_step === 'recap') throw new Error('409');
            return { ok: true };
        }) };
        const pending = await replayFirstOnboarding(conflict as never, task, desired);
        expect(pending).toEqual(expect.objectContaining({ completed: false, pending: true, currentStep: 'recap' }));
    });
});
