// Static accessibility audit over every screen and component (ADR-0133). It cannot replace a screen-reader pass, but it
// keeps the mistakes that are easy to see in code from coming back.
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readdirSync: (p: string, o: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]; readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []));
}
const files = [...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'components'))];
const rel = (f: string) => f.slice(SRC.length + 1);
const read = (f: string) => fs.readFileSync(f, 'utf8');

// The opening tag starting at `at`, found by scanning past {braces} and strings, so `onPress={() => x}` does not end it.
function openingTag(text: string, at: number): string {
    let depth = 0;
    let quote = '';
    for (let i = at; i < text.length; i++) {
        const c = text[i] as string;
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = '';
        } else if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) return text.slice(at, i + 1);
    }
    return text.slice(at);
}
const tags = (text: string, name: string): string[] => [...text.matchAll(new RegExp(`<${name}\\b`, 'g'))].map((m) => openingTag(text, m.index ?? 0));

describe('every control says what it is', () => {
    test.each(files.map(rel))('%s: Pressables have a role', (file) => {
        const text = read(path.join(SRC, file));
        const missing = tags(text, 'Pressable').filter((t) => !t.includes('accessibilityRole'));
        expect(missing.map((t) => t.slice(0, 90))).toEqual([]);
    });

    test.each(files.map(rel))('%s: text fields have a label', (file) => {
        const text = read(path.join(SRC, file));
        const missing = tags(text, 'TextInput').filter((t) => !t.includes('accessibilityLabel'));
        expect(missing.map((t) => t.slice(0, 90))).toEqual([]);
    });
});

describe('text can grow', () => {
    test.each(files.map(rel))('%s: font scaling is never turned off', (file) => {
        expect(read(path.join(SRC, file))).not.toMatch(/allowFontScaling\s*=\s*\{?\s*false/);
    });

    // At the largest text size a plain View cannot show everything, so a screen with many controls must scroll.
    test.each(files.filter((f) => f.includes(`${path.join('src', 'app')}`) || f.includes(`${'/'}app${'/'}`)).map(rel))('%s: a screen with many controls scrolls', (file) => {
        const text = read(path.join(SRC, file));
        if (!/export default function/.test(text)) return;
        if (tags(text, 'Pressable').length >= 4) expect(text).toMatch(/ScrollView|FlatList|SectionList/);
    });
});

// A title inside a tappable card in a list is part of the card, not a heading: marking every card title a heading would
// bury the real headings when moving by heading.
const CARD_TITLES = ['components/cinema/TitleCard.tsx'];

describe('a screen reader can move by heading', () => {
    test.each(files.map(rel).filter((f) => !CARD_TITLES.includes(f)))('%s: section titles carry the header role', (file) => {
        const text = read(path.join(SRC, file));
        const plain = tags(text, 'Text').filter((t) => /style=\{styles\.(sectionTitle|heading|header|title)\}/.test(t) && !t.includes('accessibilityRole="header"'));
        expect(plain.map((t) => t.slice(0, 90))).toEqual([]);
    });
});

describe('header actions stay readable at large text', () => {
    test.each(files.map(rel))('%s: headerRight uses HeaderAction', (file) => {
        const text = read(path.join(SRC, file));
        if (!text.includes('headerRight')) return;
        expect(text).toMatch(/headerRight:\s*\(\)\s*=>\s*<HeaderAction/);
    });
});
