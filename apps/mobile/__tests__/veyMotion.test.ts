declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import { HOP_COOLDOWN_MS, HOP_SCROLL_PX, INITIAL_SCROLL, nextScrollState, onVeyReaction, reactVey } from '../src/lib/veyMotion';

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

describe('the companion on a paywall', () => {
    test('peeks over the chosen card only, as decoration', () => {
        expect(read('app', '(app)', 'credits.tsx')).toContain('{chosenId === item.id ? <VeyCardPeek /> : null}');
        expect(read('components', 'UnlockCard.tsx')).toContain('{selected === p.id ? <VeyCardPeek');
        expect(read('components', 'LowBalanceNote.tsx')).not.toContain('Vey');
        for (const file of [['app', '(app)', 'credits.tsx'], ['components', 'UnlockCard.tsx']]) {
            const source = read(...file);
            expect((source.match(/<VeyCardPeek/g) ?? []).length).toBe(1);
            expect(source).not.toMatch(/notify\(|useVeyPaywallMood|VeyPaywallBuddy/);
        }
        const peek = read('components', 'VeyCardPeek.tsx');
        expect(peek).toContain('pointerEvents="none"');
        expect(peek).toContain('overflow: \'hidden\'');
        // No words of its own: nothing to translate, and nothing a screen reader reads twice.
        expect(peek).not.toMatch(/\bt\('/);
        expect(peek).not.toContain('<Text');
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
