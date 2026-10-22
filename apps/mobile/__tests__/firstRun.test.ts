declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

import { FIRST_RUN_SLOT, WELCOME_CARDS, creditsCardKeys, hasSeenWelcome, serializeSeen } from '../src/lib/firstRun';

describe('the first-run record (N3)', () => {
    test('nothing stored means the welcome has not been seen', () => {
        expect(hasSeenWelcome(null)).toBe(false);
        expect(hasSeenWelcome(undefined)).toBe(false);
        expect(hasSeenWelcome('')).toBe(false);
    });

    test('only our own versioned record counts as seen', () => {
        expect(hasSeenWelcome(serializeSeen())).toBe(true);
        expect(hasSeenWelcome('{"version":2,"seen":true}')).toBe(false);
        expect(hasSeenWelcome('{"version":1,"seen":false}')).toBe(false);
        expect(hasSeenWelcome('true')).toBe(false);
        expect(hasSeenWelcome('not json')).toBe(false);
        expect(hasSeenWelcome('[]')).toBe(false);
    });

    test('the storage name uses only the characters SecureStore allows', () => {
        expect(FIRST_RUN_SLOT).toMatch(/^[A-Za-z0-9._-]+$/);
    });
});

describe('the cards', () => {
    test('there are three, in order: hello, credits, start', () => {
        expect(WELCOME_CARDS).toEqual(['hello', 'credits', 'start']);
    });

    test('the credits card names the real free amount when the server gave one', () => {
        expect(creditsCardKeys(10)).toEqual({ title: 'welcome.credits.title', body: 'welcome.credits.free', count: 10 });
        expect(creditsCardKeys(1).count).toBe(1);
    });

    test('with no free credits, or an unreadable amount, it explains credits without a number', () => {
        for (const n of [0, -3, Number.NaN, null, undefined]) {
            expect(creditsCardKeys(n as number | null | undefined)).toEqual({ title: 'welcome.credits.title', body: 'welcome.credits.generic', count: null });
        }
    });
});

describe('where the welcome shows', () => {
    test('the signed-in layout sends a first-time person to it, and the screen records it was seen', () => {
        expect(read('app', '(app)', '_layout.tsx')).toContain('FirstRunGate');
        const gate = read('components', 'FirstRunGate.tsx');
        expect(gate).toContain("router.replace('/welcome')");
        const screen = read('app', '(app)', 'welcome.tsx');
        expect(screen).toContain('markWelcomeSeen');
        expect(screen).toContain("t('welcome.skip')");
    });

    test('the Mobbin-inspired creation goal is the first personalization choice', () => {
        const screen = read('app', '(app)', 'vibe.tsx');
        const copy = read('lib', 'i18n', 'messages', 'en', 'vibe.ts');
        expect(screen).toContain("const STEPS = ['goal', 'look', 'pace', 'chaos', 'destination', 'audience', 'voice']");
        expect(copy).toContain("'vibe.goal.title': 'What do you want to make first?'");
        expect(copy).toContain("'vibe.goal.sell': 'Promote a product'");
        expect(copy).toContain("'vibe.goal.meme': 'Make a social ad'");
        expect(copy).toContain("'vibe.goal.character': 'Animate my photo'");
        expect(copy).toContain("'vibe.goal.story': 'Tell a story'");
    });
});
