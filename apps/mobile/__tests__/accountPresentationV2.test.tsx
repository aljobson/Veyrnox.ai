import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Button, AppearanceContext, PriceText } from '../src/components/ui';
import { BrandKitEditor } from '../src/components/brand/BrandKitEditor';
import { styles, Action } from '../src/components/account/shared';
import { colors, DEFAULT_APPEARANCE, paletteForScheme, tokensForScheme } from '../src/theme';
import { touchTarget } from '../src/lib/a11y';
import { t } from '../src/lib/i18n';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.StyleSheet];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('legacy account styles retain every key and value for native-control importers', async () => {
    expect(styles).toEqual({
        card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
        title: { color: colors.text, fontSize: 17, fontWeight: '700' },
        help: { color: colors.muted, fontSize: 14 },
        name: { color: colors.text, fontSize: 16, fontWeight: '600' },
        action: { ...touchTarget, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center', alignSelf: 'flex-start' },
        actionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
        danger: { color: colors.danger }, off: { opacity: 0.5 },
        status: { color: colors.accent, fontSize: 14 },
        input: { ...touchTarget, color: colors.text, backgroundColor: colors.background, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
        label: { color: colors.muted, fontSize: 13 },
    });
    expect(RN.Platform.OS).toBe('ios');
    for (const key of ['text', 'background', 'border', 'surface', 'muted', 'danger', 'accent'] as const) {
        expect(colors[key]).toEqual(RN.DynamicColorIOS({ light: paletteForScheme('light')[key], dark: paletteForScheme('dark')[key] }));
    }
    await act(async () => root.render(<BrandKitEditor workspaceId="workspace" state={{ canEdit: true, kit: { name: 'Studio', palette: [], fonts: [], textStyles: [], assets: [] } } as any} onSaved={() => {}} />));
    const input = root.container.queryAll(n => n.props.accessibilityLabel === t('brand.name') && n.props.onChangeText)[0];
    expect(RN.StyleSheet.flatten(input.props.style)).toMatchObject(styles.input);
    expect(input.props.editable).toBe(true);
    expect(Action).toEqual(expect.any(Function));
});

test.each(['light', 'dark', 'oled'] as const)('Button optional tone is backward compatible in %s', async theme => {
    const settings = { ...DEFAULT_APPEARANCE, theme };
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', settings);
    const action = jest.fn();
    await act(async () => root.render(<AppearanceContext.Provider value={settings}>
        <Button label="Default" onPress={action} />
        <Button label="Remove" variant="tertiary" tone="danger" accessibilityState={{ selected: true }} onPress={action} />
        <Button label="Disabled" variant="tertiary" tone="danger" disabled onPress={action} />
    </AppearanceContext.Provider>));
    const text = (value: string) => root.container.queryAll(n => n.children.includes(value))[0];
    expect(RN.StyleSheet.flatten(text('Default').props.style).color).toBe(p.onAccent);
    expect(RN.StyleSheet.flatten(text('Remove').props.style).color).toBe(p.danger);
    const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
    expect(button('Remove').props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(RN.StyleSheet.flatten(button('Remove').props.style).backgroundColor).toBeUndefined();
    expect(button('Disabled').props.accessibilityState.disabled).toBe(true);
    await act(async () => button('Remove').props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(action).toHaveBeenCalledTimes(1);
});

test.each(['light', 'dark', 'oled'] as const)('only price fragments use warning and tabular figures in %s', async theme => {
    const settings = { ...DEFAULT_APPEARANCE, theme };
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', settings);
    await act(async () => root.render(<AppearanceContext.Provider value={settings}>
        <PriceText text="Stay for £4.99 for 3 cycles" price="£4.99" variant="footnote" tone="secondary" />
    </AppearanceContext.Provider>));
    const price = root.container.queryAll(n => n.children.includes('£4.99'))[0];
    expect(RN.StyleSheet.flatten(price.props.style)).toMatchObject({ color: p.warning, fontVariant: ['tabular-nums'] });
    const sentence = root.container.queryAll(n => n.children.includes('Stay for '))[0];
    expect(RN.StyleSheet.flatten(sentence.props.style).color).toBe(p.textSecondary);
    expect(RN.StyleSheet.flatten(sentence.props.style).fontVariant).toBeUndefined();
});
