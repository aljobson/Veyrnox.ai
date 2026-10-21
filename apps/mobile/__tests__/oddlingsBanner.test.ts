declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string; existsSync: (p: string) => boolean };
const path = require('path') as { join: (...p: string[]) => string };
const app = (...p: string[]) => path.join(__dirname, '..', 'src', 'app', '(app)', ...p);

// The Oddlings banner on Explore (the plan's N4 leftover): one tap from the home to the Oddlings area.
describe('the Oddlings banner on Explore', () => {
    const explore = fs.readFileSync(app('(tabs)', 'index.tsx'), 'utf8');

    test('opens the Oddlings screen, and that screen exists', () => {
        expect(explore).toContain('href="/oddlings"');
        expect(fs.existsSync(app('oddlings', 'index.tsx'))).toBe(true);
    });

    test('reads as a button with a name and a hint, not a bare image', () => {
        expect(explore).toContain("t('explore.oddlings.title')");
        // The row component turns `hint` into the accessibilityHint of one button, with the title as its label.
        expect(explore).toContain("hint={t('explore.oddlings.hint')}");
        expect(explore).toContain('accessibilityHint={hint}');
        expect(explore).toContain('accessibilityLabel={title}');
    });
});
