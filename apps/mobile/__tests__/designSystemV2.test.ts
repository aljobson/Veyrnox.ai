import ts from 'typescript';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, encoding: string): string; readdirSync(p: string): string[]; existsSync(p: string): boolean };
const path = require('path') as { join(...parts: string[]): string; resolve(...parts: string[]): string };
import {
    ACCENTS,
    DEFAULT_APPEARANCE,
    TEXT_SCALE,
    TEXT_SIZES,
    TYPEFACES,
    THEME_PREFERENCES,
    needsReload,
    paletteForScheme,
    parseAccent,
    parseTextSize,
    parseThemePreference,
    parseTypeface,
    rampFor,
    resolveScheme,
    tokensForScheme,
    space,
    radius,
    type as legacyType,
} from '../src/theme';
import type { AppearanceSettings } from '../src/theme';
const root = path.join(__dirname, '..', 'src');
const migrated = [
    'app/(app)/analytics-consent.tsx',
    'app/(app)/privacy-choices.tsx',
    'components/AnalyticsChoices.tsx',
    'app/(app)/pricing.tsx', 'app/(app)/developers.tsx',
    ...fs.readdirSync(path.join(root, 'components/credits')).map(name => `components/credits/${name}`),
    'components/LanguageChoice.tsx',
    'components/LanguageGate.tsx',
    'app/(app)/language.tsx',
    'components/MenuDrawer.tsx',
    'app/(app)/(tabs)/editor.tsx',
    'app/(app)/(tabs)/publish.tsx',
    'app/(app)/account.tsx',
    ...fs.readdirSync(path.join(root, 'components/account')).filter(name => name !== 'shared.tsx').map(name => `components/account/${name}`),
    'app/(app)/legal/[doc].tsx',
    'components/InlineMedia.tsx',
    'components/ReviewMedia.tsx',
    'components/AddressText.tsx',
    'components/ComingToApp.tsx',
    'components/AiConsentHost.tsx',
    ...fs.readdirSync(path.join(root, 'components/legal')).map(name => `components/legal/${name}`),
    'app/sign-in.tsx',
    'app/email.tsx',
    ...['welcome', 'start', 'vibe', 'appearance'].map((name) => `app/(app)/${name}.tsx`),
    'app/(app)/(tabs)/index.tsx',
    'app/(app)/(tabs)/_layout.tsx',
    'components/HeaderChips.tsx',
    ...['(tabs)/create', 'create/[modelId]', 'job/[id]', '(tabs)/library', 'credits'].map(name => `app/(app)/${name}.tsx`),
    ...['FreeAllowanceCard', 'CameraPanel', 'CharacterPanel', 'CreateOptions', 'AttachFromDevice', 'SourcePicker', 'TemplateBanner', 'VeyCardPeek', 'JobProvenance', 'StemList', 'LibraryItem', 'StaleNote', 'EmptyState'].map(name => `components/${name}.tsx`),
    ...fs.readdirSync(path.join(root, 'components/create')).map(name => `components/create/${name}`),
    ...fs.readdirSync(path.join(root, 'components/ui')).map((name) => `components/ui/${name}`),
    ...fs.readdirSync(path.join(root, 'components/home')).map((name) => `components/home/${name}`),
    'app/(app)/create/agent.tsx',
    ...fs.readdirSync(path.join(root, 'app/(app)/chat')).filter(name => name.endsWith('.tsx')).map(name => `app/(app)/chat/${name}`),
    ...fs.readdirSync(path.join(root, 'app/(app)/chat/persona')).map(name => `app/(app)/chat/persona/${name}`),
    ...fs.readdirSync(path.join(root, 'components/chat')).map(name => `components/chat/${name}`),
];
// Inspect parsed text, so comments are not icons and escaped string literals cannot bypass the guard.
const iconText = /[\u2190-\u21ff\u25a0-\u27bf\u2039\u203a]/u;
const heavyWeight = /['"]?fontWeight['"]?\s*:\s*(?:['"](?:800|900)['"]|(?:800|900)\b)/;
function textIcons(source: string): string[] {
    const file = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    function visit(node: ts.Node) {
        if ((ts.isStringLiteral(node) || ts.isJsxText(node) || ts.isTemplateLiteralToken(node)) && iconText.test(node.text)) found.push(node.text);
        ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
}
test.each(["const kind = '▣'", "const kind = '♪'", "const star = '☆'", "const up = '↑'", "const down = '↓'", '<Text>›</Text>', '<Text>☐ ☑ ★ ▶ ↗ ‹</Text>', 'const escaped = "\\u2191"'])('rejects text icons: %s', source => {
    expect(textIcons(source).length).toBeGreaterThan(0);
});
test.each(["{ fontWeight: '800' }", '{ fontWeight: "900" }', '{ fontWeight: 800 }', '{ fontWeight: 900 }'])('rejects heavy weights: %s', source => {
    expect(source).toMatch(heavyWeight);
});
test('ordinary punctuation remains valid in JSX, strings and templates', () => {
    expect(textIcons('<Text>… – — “quotes” ‘quotes’ × creator’s</Text>; const s = "… – — × ’"; const t = `… ${n} —`;')).toEqual([]);
    expect(textIcons('// A → B is a comment\nconst value = "Words";')).toEqual([]);
    expect("{ fontWeight: '700' }").not.toMatch(heavyWeight);
});
test.each(migrated)('%s uses tokens, the ramp and real icons', (file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    expect(source).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    expect(source).not.toMatch(heavyWeight);
    expect(textIcons(source)).toEqual([]);
    expect(source).not.toMatch(/fontSize\s*:\s*\d/);
    expect(source).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(source).not.toMatch(/textTransform\s*:\s*['"]uppercase['"]/);
    expect(source.split('\n').length).toBeLessThan(file.includes('components/ui') ? 250 : 500);
});
test('parsers accept only the enumerated choices, with defaults for invalid storage', () => {
    for (const [parser, options, fallback] of [
        [parseThemePreference, THEME_PREFERENCES, 'system'],
        [parseAccent, ACCENTS, 'mint'],
        [parseTypeface, TYPEFACES, 'studio'],
        [parseTextSize, TEXT_SIZES, 'm'],
    ] as const) {
        options.forEach((option) => expect(parser(option)).toBe(option));
        [null, undefined, '', '{}', 'LIGHT', 5].forEach((value) => expect(parser(value)).toBe(fallback));
    }
});
test('OLED changes only the specified dark surfaces and resolves native dark', () => {
    const oled = { ...DEFAULT_APPEARANCE, theme: 'oled' as const };
    const p = tokensForScheme('dark', oled);
    expect(resolveScheme('oled', 'light')).toBe('dark');
    expect(p).toMatchObject({ bg: '#000000', bgElevated1: '#0e0e10', bgElevated2: '#17171a', surface: '#1c1c1f', borderSubtle: '#222226' });
    expect(p.textPrimary).toBe(tokensForScheme('dark').textPrimary);
    expect(paletteForScheme('dark', oled).background).toBe('#000000');
});
test.each(ACCENTS)('legacy mapping follows %s', (accent) => {
    for (const scheme of ['light', 'dark'] as const) {
        const settings = { ...DEFAULT_APPEARANCE, accent },
            p = tokensForScheme(scheme, settings);
        expect(paletteForScheme(scheme, settings)).toEqual({
            background: p.bg,
            surface: p.bgElevated1,
            border: p.borderSubtle,
            borderStrong: p.borderStrong,
            text: p.textPrimary,
            body: p.textSecondary,
            muted: p.textTertiary,
            accent: p.accent,
            accentInk: p.onAccent,
            accentSoft: p.accentSubtle,
            money: p.warning,
            danger: p.danger,
        });
    }
});
const lum = (hex: string) =>
    [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
test.each(ACCENTS)('%s meets the agreed contrast thresholds', (accent) => {
    for (const scheme of ['light', 'dark'] as const) {
        const p = tokensForScheme(scheme, { ...DEFAULT_APPEARANCE, accent });
        expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.accent, p.bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(p.textSecondary, p.bg)).toBeGreaterThanOrEqual(4.5);
    }
});
test.each(TEXT_SIZES)('the complete ramp scales with %s', (textSize) => {
    const normal = rampFor(DEFAULT_APPEARANCE),
        scaled = rampFor({ ...DEFAULT_APPEARANCE, textSize });
    for (const key of Object.keys(normal) as (keyof typeof normal)[]) {
        expect(scaled[key].fontSize).toBeCloseTo(normal[key].fontSize! * TEXT_SCALE[textSize]);
        expect(scaled[key].lineHeight).toBeCloseTo(normal[key].lineHeight! * TEXT_SCALE[textSize]);
    }
});
test('legacy size contracts remain exact', () => {
    expect(space).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24 });
    expect(radius).toEqual({ sm: 6, md: 10, lg: 12, pill: 999 });
    expect(legacyType).toEqual({
        caption: { fontSize: 12 },
        small: { fontSize: 13 },
        footnote: { fontSize: 14 },
        callout: { fontSize: 15 },
        body: { fontSize: 16 },
        titleLarge: { fontFamily: 'Archivo_700Bold', fontSize: 32 },
        label: { fontSize: 16, fontWeight: '600' },
    });
});
const settings = (value: Partial<AppearanceSettings>) => ({ ...DEFAULT_APPEARANCE, ...value });
test.each([
    [{}, { accent: 'iris' }, true],
    [{}, { typeface: 'editorial' }, true],
    [{}, { textSize: 'xl' }, true],
    [{ theme: 'dark' }, { theme: 'oled' }, true],
    [{ theme: 'oled' }, { theme: 'dark' }, true],
    [{ theme: 'oled' }, { theme: 'light' }, true],
    [{ theme: 'light' }, { theme: 'dark' }, false],
    [{ theme: 'dark' }, { theme: 'light' }, false],
    [{ theme: 'system' }, { theme: 'light' }, false],
    [{}, {}, false],
] as [Partial<AppearanceSettings>, Partial<AppearanceSettings>, boolean][])('transition %j → %j', (prev, next, reload) => {
    expect(needsReload(settings(prev), settings(next), 'ios')).toBe(reload);
    expect(needsReload(settings(prev), settings(next), 'android')).toBe(JSON.stringify(settings(prev)) !== JSON.stringify(settings(next)));
});
test('every registered icon file exists, including every host-prep icon', () => {
    const source = fs.readFileSync(path.join(root, 'lib/menuIcons.ts'), 'utf8');
    const paths = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
    expect(paths.length).toBeGreaterThanOrEqual(55);
    paths.forEach((file) => expect(fs.existsSync(path.resolve(root, 'lib', file))).toBe(true));
});

test.each(['light', 'dark', 'oled'] as const)('%s input boundaries and disabled labels meet 3:1', theme => {
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', { ...DEFAULT_APPEARANCE, theme });
    for (const adjacent of [p.bg, p.bgElevated1, p.bgElevated2, p.surface, p.surfacePressed])
        expect(contrast(p.borderStrong, adjacent)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.textTertiary, p.surface)).toBeGreaterThanOrEqual(3);
});
