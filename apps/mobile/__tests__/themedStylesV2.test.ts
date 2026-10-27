import { StyleSheet } from 'react-native';
import { themedStyles } from '../src/components/ui/AppearanceContext';
import { DEFAULT_APPEARANCE, tokensForScheme, type AppearanceSettings } from '../src/theme';

test('each caller builds at most one new sheet set per pending change, regardless of consumer count', () => {
    const callers = Array.from({ length: 5 }, () => themedStyles((p) => ({ label: { color: p.textPrimary } })));
    const create = jest.spyOn(StyleSheet, 'create');
    try {
        let pending: AppearanceSettings = { ...DEFAULT_APPEARANCE, theme: 'light' };
        for (const change of [{}, { theme: 'oled' }, { accent: 'iris' }, { typeface: 'technical' }, { textSize: 'xl' }] satisfies Partial<AppearanceSettings>[]) {
            pending = { ...pending, ...change };
            for (const caller of callers) {
                create.mockClear();
                for (let i = 0; i < 20; i++) caller(pending, pending.theme === 'light' ? 'light' : 'dark');
                expect(create).toHaveBeenCalledTimes(1);
            }
        }
    } finally { create.mockRestore(); }
});

test('theme sheets are lazy, cache every settings dimension and reuse equivalent native schemes', () => {
    const make = jest.fn();
    const create = jest.spyOn(StyleSheet, 'create');
    try {
        const sheets = themedStyles((p, ramp, scheme) => {
            make();
            return { surface: { backgroundColor: p.bg, opacity: scheme === 'light' ? 1 : 0.9 }, label: { fontSize: ramp.body.fontSize } };
        });
        expect(make).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        const first = sheets(DEFAULT_APPEARANCE, 'light');
        expect(sheets({ ...DEFAULT_APPEARANCE }, 'light')).toBe(first);
        expect(sheets({ ...DEFAULT_APPEARANCE, theme: 'light' }, 'light')).toBe(first);
        expect(make).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledTimes(1);
        for (const change of [{ accent: 'iris' }, { typeface: 'editorial' }, { textSize: 'xl' }, { theme: 'oled' }] satisfies Partial<AppearanceSettings>[]) {
            const settings = { ...DEFAULT_APPEARANCE, ...change };
            const sheet = sheets(settings, 'dark');
            expect(sheet).not.toBe(first);
            expect(sheet.surface.backgroundColor).toBe(tokensForScheme('dark', settings).bg);
            expect(sheets(settings, 'dark')).toBe(sheet);
        }
        const dark = sheets(DEFAULT_APPEARANCE, 'dark');
        expect(dark).not.toBe(first);
        expect(sheets({ ...DEFAULT_APPEARANCE, theme: 'dark' }, 'dark')).toBe(dark);
        expect(sheets(DEFAULT_APPEARANCE, 'light')).toBe(first);
        expect(make).toHaveBeenCalledTimes(6);
        expect(create).toHaveBeenCalledTimes(6);
    } finally {
        create.mockRestore();
    }
});
