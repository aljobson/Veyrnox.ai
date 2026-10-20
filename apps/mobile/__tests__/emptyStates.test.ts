declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const src = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

import { LOW_BALANCE_FALLBACK, cheapestCredits, isLowBalance } from '../src/lib/lowBalance';

describe('the low-balance rule (N6)', () => {
    test('the cheapest template price is the smallest positive whole number', () => {
        expect(cheapestCredits([{ credits: 18 }, { credits: 4 }, { credits: 9 }])).toBe(4);
        expect(cheapestCredits([{ credits: 0 }, { credits: -2 }, { credits: 2.5 }])).toBeNull();
        expect(cheapestCredits([])).toBeNull();
        expect(cheapestCredits(null)).toBeNull();
    });

    test('low means the person cannot afford even the cheapest template', () => {
        expect(isLowBalance(3, 4)).toBe(true);
        expect(isLowBalance(4, 4)).toBe(false);
        expect(isLowBalance(0, 4)).toBe(true);
    });

    test('without a price list, a fixed small amount is the line', () => {
        expect(isLowBalance(LOW_BALANCE_FALLBACK - 1, null)).toBe(true);
        expect(isLowBalance(LOW_BALANCE_FALLBACK, null)).toBe(false);
    });

    test('an unknown or unreadable balance never shows the prompt', () => {
        expect(isLowBalance(null, 4)).toBe(false);
        expect(isLowBalance(undefined, null)).toBe(false);
        expect(isLowBalance(Number.NaN, 4)).toBe(false);
    });
});

describe('where the empty states and prompt show', () => {
    const app = (...p: string[]) => src('app', '(app)', ...p);

    test('an empty Library and an empty Posts list say what to do next', () => {
        expect(app('(tabs)', 'library.tsx')).toContain('<EmptyState');
        expect(app('publish', 'posts.tsx')).toContain('<EmptyState');
    });

    test('Explore shows the low-balance prompt with a way to buy credits', () => {
        const explore = app('(tabs)', 'index.tsx');
        expect(explore).toContain('<LowBalanceNote');
        expect(src('components', 'LowBalanceNote.tsx')).toContain("router.push('/credits')");
    });

    test('the empty state announces itself and its action has a name', () => {
        const c = src('components', 'EmptyState.tsx');
        expect(c).toContain('accessibilityRole="header"');
        expect(c).toContain('accessibilityRole="button"');
    });
});
