declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

describe('the companion on a paywall', () => {
    test('peeks over the chosen card only, as decoration', () => {
        expect(read('app', '(app)', 'credits.tsx')).toContain('{chosenId === item.id ? <VeyCardPeek /> : null}');
        expect(read('components', 'UnlockCard.tsx')).toContain('{selected === p.id ? <VeyCardPeek');
        expect(read('app', '(app)', '(tabs)', 'publish.tsx')).toContain('{selectedPlan === plan.id ? <VeyCardPeek width={72} /> : null}');
        expect(read('components', 'LowBalanceNote.tsx')).not.toContain('Vey');
        for (const file of [['app', '(app)', 'credits.tsx'], ['components', 'UnlockCard.tsx'], ['app', '(app)', '(tabs)', 'publish.tsx']]) {
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

describe('the Vey character', () => {
    test('stands still under Reduce Motion whatever the mood', () => {
        const character = read('components', 'VeyCharacter.tsx');
        expect(character).toContain('isReduceMotionEnabled');
        expect(character).toMatch(/if \(still\) \{[\s\S]*?droop\.setValue\(0\);[\s\S]*?return;/);
    });
});
