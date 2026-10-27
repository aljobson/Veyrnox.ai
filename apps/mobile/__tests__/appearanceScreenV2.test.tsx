import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import AppearanceScreen from '../src/app/(app)/appearance';
import { DEFAULT_APPEARANCE, ACCENTS, accentPairs, tokensForScheme, getAppearance, applyAppearance, type AppearanceSettings } from '../src/theme';

let mockApplied: AppearanceSettings = { ...DEFAULT_APPEARANCE, theme: 'light' };
const mockTextRenders = jest.fn();
jest.mock('../src/theme', () => ({
    ...jest.requireActual('../src/theme'),
    applyAppearance: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-secure-store', () => ({ getItem: () => null, setItem: jest.fn() }));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), reloadAppAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, usePathname: () => '/appearance' }));
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));
jest.mock('../src/components/ui/FontCatalog', () => ({ previewFonts: {} }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../src/components/ui/Text', () => {
    const actual = jest.requireActual('../src/components/ui/Text');
    return { ...actual, Text: (props: any) => { mockTextRenders(props.children); return actual.Text(props); } };
});
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
beforeEach(async () => {
    mockApplied = { ...DEFAULT_APPEARANCE, theme: 'light' };
    await jest.requireActual('../src/theme').applyAppearance(mockApplied);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    await act(async () => root.render(<AppearanceScreen />));
    mockTextRenders.mockClear();
    jest.mocked(applyAppearance).mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); });
async function tap(label: string) {
    const node = root.container.queryAll((n) => typeof n.props.onClick === 'function' && (
        n.props.accessibilityLabel === label || (n.props.accessibilityRole === 'tab' && n.children.some((child) => typeof child !== 'string' && child.children.includes(label)))
    ))[0];
    expect(node).toBeDefined();
    await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
function textStyle(label: string) {
    const node = root.container.queryAll((n) => n.props.children === label && n.props.style)[0];
    expect(node).toBeDefined();
    return RN.StyleSheet.flatten(node.props.style);
}
test.each(['oled', 'dark'] as const)('applied %s + Iris retains dark swatches and typefaces when Light is pending', async (theme) => {
    await act(async () => root.unmount());
    mockApplied = { ...DEFAULT_APPEARANCE, theme, accent: 'iris' };
    await jest.requireActual('../src/theme').applyAppearance(mockApplied);
    root = createRoot();
    await act(async () => root.render(<AppearanceScreen />));
    const applied = tokensForScheme('dark', mockApplied);
    expect(textStyle('Mint').color).toBe('#f2f2f3');
    expect(textStyle('Your next idea').color).toBe('#f2f2f3');
    await tap('Light');
    for (const label of ['Mint', 'Iris', 'Sky', 'Rose', 'Mono', 'Aa', 'Studio', 'Editorial', 'Technical']) {
        expect(textStyle(label).color).toBe('#f2f2f3');
    }
    const typefaceLetters = root.container.queryAll((n) => n.props.children === 'Aa' && n.props.style);
    expect(typefaceLetters).toHaveLength(3);
    for (const node of typefaceLetters) expect(RN.StyleSheet.flatten(node.props.style).color).toBe('#f2f2f3');
    const fills = root.container.queryAll((n) => {
        const style = RN.StyleSheet.flatten(n.props.style);
        return style?.width === 32 && style?.height === 32;
    }).map((n) => RN.StyleSheet.flatten(n.props.style).backgroundColor);
    expect(fills).toEqual(ACCENTS.map((accent) => accentPairs[accent].dark[0]));
    const rings = root.container.queryAll((n) => {
        const style = RN.StyleSheet.flatten(n.props.style);
        return style?.width === 44 && style?.borderWidth === 2;
    }).map((n) => RN.StyleSheet.flatten(n.props.style).borderColor);
    expect(rings).toEqual([applied.bg, applied.accent, applied.bg, applied.bg, applied.bg]);
    expect(textStyle('Your next idea').color).toBe('#0a0a0b');
    const preview = root.container.queryAll((n) => n.props.testID === 'appearance-preview')[0];
    expect(RN.StyleSheet.flatten(preview.props.style).backgroundColor).toBe(tokensForScheme('light', { ...mockApplied, theme: 'light' }).bgElevated1);
    expect(textStyle('Apply').color).toBe(applied.onAccent);
    expect(getAppearance()).toEqual(mockApplied);
    expect(applyAppearance).not.toHaveBeenCalled();
});
test.each(['oled', 'dark'] as const)('pending %s stays in the preview; labels, typeface cards and Apply retain applied light colours', async (theme) => {
    const applied = tokensForScheme('light', mockApplied);
    await tap(theme === 'oled' ? 'OLED' : 'Dark');
    for (const label of ['Mint', 'Iris', 'Sky', 'Rose', 'Mono', 'Aa', 'Studio', 'Editorial', 'Technical']) {
        expect(textStyle(label).color).toBe(applied.textPrimary);
    }
    expect(textStyle('Your next idea').color).toBe(tokensForScheme('dark', { ...mockApplied, theme }).textPrimary);
    expect(textStyle('Apply').color).toBe(applied.onAccent);
    const rings = root.container.queryAll((n) => {
        const style = RN.StyleSheet.flatten(n.props.style);
        return style?.width === 44 && style?.borderWidth === 2;
    }).map((n) => RN.StyleSheet.flatten(n.props.style));
    expect(rings).toHaveLength(5);
    expect(rings.map((s) => s.borderColor)).toEqual([applied.accent, applied.bg, applied.bg, applied.bg, applied.bg]);
    for (const name of ['Studio', 'Editorial', 'Technical']) {
        const option = root.container.queryAll((n) => n.props.accessibilityLabel === name)[0];
        const card = option.children[0];
        if (typeof card === 'string') throw new Error('Expected a typeface card');
        expect(RN.StyleSheet.flatten(card.props.style)).toMatchObject({
            backgroundColor: name === 'Studio' ? applied.accentSubtle : applied.bgElevated1,
            borderColor: name === 'Studio' ? applied.accent : applied.borderSubtle,
        });
    }
    const apply = root.container.queryAll((n) => n.props.accessibilityLabel === 'Apply')[0];
    expect(RN.StyleSheet.flatten(apply.props.style).backgroundColor).toBe(applied.accent);
    const preview = root.container.queryAll((n) => n.props.testID === 'appearance-preview')[0];
    expect(RN.StyleSheet.flatten(preview.props.style).backgroundColor).toBe(tokensForScheme('dark', { ...mockApplied, theme }).bgElevated1);
});
test('pending taps rerender only the preview and changed controls, and Apply receives every choice', async () => {
    await tap('OLED');
    const themeRenders = mockTextRenders.mock.calls.map(([label]) => label);
    expect(themeRenders).toContain('Your next idea');
    for (const label of ['Mint', 'Iris', 'Aa', 'Studio', 'Accent', 'Typeface', 'Apply', 'S', 'M']) expect(themeRenders).not.toContain(label);
    mockTextRenders.mockClear();
    await tap('Iris');
    const accentRenders = mockTextRenders.mock.calls.map(([label]) => label);
    expect(accentRenders).toEqual(expect.arrayContaining(['Your next idea', 'Mint', 'Iris']));
    for (const label of ['OLED', 'Light', 'Sky', 'Rose', 'Mono', 'Aa', 'Apply']) expect(accentRenders).not.toContain(label);
    await tap('Technical');
    await tap('XL');
    await tap('Apply');
    expect(applyAppearance).toHaveBeenCalledWith({ theme: 'oled', accent: 'iris', typeface: 'technical', textSize: 'xl' }, '/appearance');
});
