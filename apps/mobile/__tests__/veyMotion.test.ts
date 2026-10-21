declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import { HOP_COOLDOWN_MS, HOP_SCROLL_PX, INITIAL_SCROLL, PAYWALL_MOODS, nextScrollState, onVeyReaction, paywallMoodFor, reactVey, type PaywallEvent } from '../src/lib/veyMotion';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

describe('Vey hops as a list scrolls', () => {
    test('once the list has moved far enough, in either direction, and not before', () => {
        const small = nextScrollState(INITIAL_SCROLL, HOP_SCROLL_PX - 1, 0);
        expect(small.hop).toBe(false);
        const far = nextScrollState(small.state, HOP_SCROLL_PX, 10);
        expect(far.hop).toBe(true);
        expect(far.state.travelled).toBe(0);
        expect(nextScrollState({ ...INITIAL_SCROLL, y: 1000 }, 1000 - HOP_SCROLL_PX, 0).hop).toBe(true);
    });

    test('a long scroll is a few hops, not one per frame', () => {
        let state = INITIAL_SCROLL;
        let hops = 0;
        for (let frame = 1; frame <= 600; frame += 1) {
            const step = nextScrollState(state, frame * 40, frame * 16);
            state = step.state;
            if (step.hop) hops += 1;
        }
        expect(hops).toBeGreaterThanOrEqual(3);
        expect(hops).toBeLessThanOrEqual(Math.ceil(9600 / HOP_COOLDOWN_MS) + 1);
    });

    test('the distance keeps counting through the cooldown', () => {
        const first = nextScrollState(INITIAL_SCROLL, HOP_SCROLL_PX, 0);
        const resting = nextScrollState(first.state, HOP_SCROLL_PX * 2, 100);
        expect(resting.hop).toBe(false);
        expect(nextScrollState(resting.state, HOP_SCROLL_PX * 2, HOP_COOLDOWN_MS).hop).toBe(true);
    });
});

describe('the companion beside a paywall', () => {
    test('has a mood for everything the reader does, and every held mood ends', () => {
        const events = Object.keys(PAYWALL_MOODS) as PaywallEvent[];
        expect(events.sort()).toEqual(['ambient', 'checkout', 'credited', 'error', 'select', 'welcomeFirst', 'welcomeLow']);
        for (const event of events) expect(Number.isInteger(paywallMoodFor(event).holdMs)).toBe(true);
        // Only an open store sheet keeps a mood until something else changes it.
        expect(events.filter((e) => paywallMoodFor(e).holdMs === 0)).toEqual(['checkout']);
        expect(paywallMoodFor('credited').mood).toBe('cheer');
        expect(paywallMoodFor('error').mood).toBe('worried');
        expect(paywallMoodFor('welcomeLow').mood).toBe('worried');
    });

    test('is on every place the app sells something, as decoration only', () => {
        expect(read('app', '(app)', 'credits.tsx')).toContain('<VeyPaywallBuddy');
        expect(read('components', 'UnlockCard.tsx')).toContain('<VeyPaywallBuddy');
        expect(read('components', 'LowBalanceNote.tsx')).toContain('<VeyPaywallBuddy');
        const buddy = read('components', 'VeyPaywallBuddy.tsx');
        expect(buddy).toContain('pointerEvents="none"');
        // No words of its own: nothing to translate, and nothing a screen reader reads twice.
        expect(buddy).not.toMatch(/\bt\('/);
        expect(buddy).not.toContain('<Text');
    });
});

describe('the floating Vey', () => {
    test('hears reactions from screens that do not know about it, and stops hearing when unmounted', () => {
        const heard: string[] = [];
        const stop = onVeyReaction((mood, ms) => heard.push(`${mood}:${ms}`));
        reactVey('hop', 900);
        stop();
        reactVey('cheer', 1100);
        expect(heard).toEqual(['hop:900']);
    });

    test('hops while the main lists scroll and cheers when touched', () => {
        for (const file of [['app', '(app)', '(tabs)', 'index.tsx'], ['app', '(app)', '(tabs)', 'create.tsx'], ['app', '(app)', '(tabs)', 'library.tsx'], ['app', '(app)', 'pricing.tsx'], ['app', '(app)', 'credits.tsx']]) {
            const source = read(...file);
            expect(source).toContain('useVeyScroll()');
            expect(source).toContain('onScroll={onScroll}');
        }
        const mascot = read('components', 'VeyMascot.tsx');
        expect(mascot).toContain("reactVey('cheer'");
        expect(mascot).toContain('onVeyReaction');
    });

    test('stands still under Reduce Motion whatever the mood', () => {
        const character = read('components', 'VeyCharacter.tsx');
        expect(character).toContain('isReduceMotionEnabled');
        expect(character).toMatch(/if \(still\) \{[\s\S]*?droop\.setValue\(0\);[\s\S]*?return;/);
    });
});
