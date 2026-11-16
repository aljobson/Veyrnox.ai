// The Explore home "Instruments" card shows a piano-keys icon, not the Create card's sparkle.
import { MENU_ICONS } from '../src/lib/menuIcons';
declare const require: (id: string) => unknown;
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, encoding: string): string; existsSync(p: string): boolean };
const path = require('path') as { join(...parts: string[]): string };

const explore = fs.readFileSync(path.join(__dirname, '../src/app/(app)/(tabs)/index.tsx'), 'utf8');
const card = explore.split('\n').find((line) => line.includes('<StartOption href="/instruments"')) ?? '';

test('the Instruments card uses the piano-keys icon, not the sparkle', () => {
    expect(card).toContain('icon="pianoKeys"');
    expect(card).not.toContain('icon="sparkle"');
});

test('the piano-keys icon is registered and its file exists', () => {
    expect(MENU_ICONS.pianoKeys).toBeDefined();
    expect(fs.existsSync(path.join(__dirname, '../assets/icons/piano-keys.png'))).toBe(true);
});

test('the card stays decorative: the icon is hidden from assistive tech and the title is the label', () => {
    const icon = fs.readFileSync(path.join(__dirname, '../src/components/ui/Icon.tsx'), 'utf8');
    expect(icon).toContain('accessibilityElementsHidden');
    expect(card).toContain("title={t('instruments.title')}");
});
