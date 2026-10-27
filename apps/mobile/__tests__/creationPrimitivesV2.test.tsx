import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Button, Card, Checkbox, Chip, ListRow, SegmentedControl, Text, TextField } from '../src/components/ui';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';
import { DEFAULT_APPEARANCE, tokensForScheme, type ThemePreference } from '../src/theme';
import { MENU_ICONS } from '../src/lib/menuIcons';

void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Image, RN.ActivityIndicator];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];

test('icon-only actions retain labels, selected and busy states, hit slop, and callbacks', async () => {
    const press = jest.fn();
    await act(async () => root.render(<Button variant="secondary" label="Favourite" icon="starFill" iconOnly testID="favourite" hitSlop={12} accessibilityState={{ selected: true, busy: true }} onPress={press} />));
    const button = control('Favourite');
    expect(button.props.testID).toBe('favourite');
    expect(button.props.accessibilityState).toMatchObject({ selected: true, busy: true, disabled: false });
    expect(button.props.hitSlop).toBe(12);
    expect(root.container.queryAll(n => n.children.includes('Favourite'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.source === MENU_ICONS.starFill)).toHaveLength(1);
    await act(async () => button.props.onClick(event));
    expect(press).toHaveBeenCalledTimes(1);
});

test('rich purchase buttons keep their contents, layout and disabled gate', async () => {
    const press = jest.fn();
    await act(async () => root.render(<Button label="Buy 100 credits, £5" variant="secondary" disabled containerStyle={{ flex: 1 }} onPress={press}><Text>£5</Text></Button>));
    expect(root.container.queryAll(n => n.children.includes('£5'))).toHaveLength(1);
    expect(control('Buy 100 credits, £5').props.accessibilityState.disabled).toBe(true);
    await act(async () => control('Buy 100 credits, £5').props.onClick?.(event));
    expect(press).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.flex === 1).length).toBeGreaterThan(0);
});

test.each<ThemePreference>(['light', 'dark', 'oled'])('selectable cards, price text and row accessories use %s tokens', async theme => {
    const settings = { ...DEFAULT_APPEARANCE, theme, accent: 'iris' as const };
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', settings);
    const press = jest.fn();
    await act(async () => root.render(<AppearanceContext.Provider value={settings}>
        <Card selected accessibilityRole="radio" accessibilityLabel="Plan" accessibilityState={{ selected: true }} onPress={press}><Text>Starter</Text></Card>
        <ListRow title="Model" subtitle="Video" accessibilityLabel="Open model" trailing={<Text tone="warning">12 credits</Text>} style={{ padding: 20 }} onPress={press} />
    </AppearanceContext.Provider>));
    expect(control('Plan').props.accessibilityRole).toBe('radio');
    expect(RN.StyleSheet.flatten(control('Plan').props.style)).toMatchObject({ minHeight: 44, borderColor: p.accent, backgroundColor: p.accentSubtle });
    expect(RN.StyleSheet.flatten(control('Open model').props.style).padding).toBe(20);
    const price = root.container.queryAll(n => n.children.includes('12 credits'))[0];
    expect(RN.StyleSheet.flatten(price.props.style)).toMatchObject({ color: p.warning, fontVariant: ['tabular-nums'] });
    expect(root.container.queryAll(n => n.props.source === MENU_ICONS.caretRight)).toHaveLength(0);
    await act(async () => control('Plan').props.onClick(event));
    await act(async () => control('Open model').props.onClick(event));
    expect(press).toHaveBeenCalledTimes(2);
});

test('chips and tabs preserve full accessible labels independently of visible labels', async () => {
    const chip = jest.fn(), tab = jest.fn();
    await act(async () => root.render(<>
        <Chip label="5s" selected accessibilityLabel="5 seconds" testID="duration" onPress={chip} />
        <SegmentedControl accessibilityLabel="Make" options={[{ value: 'image', label: 'Image', accessibilityLabel: 'Make an image', icon: 'image' }, { value: 'video', label: 'Video' }]} value="video" onChange={tab} />
    </>));
    expect(control('5 seconds').props.accessibilityState.selected).toBe(true);
    expect(control('5 seconds').props.testID).toBe('duration');
    expect(control('Make an image').props.accessibilityState.selected).toBe(false);
    expect(root.container.queryAll(n => n.props.source === MENU_ICONS.image)).toHaveLength(1);
    await act(async () => control('5 seconds').props.onClick(event));
    await act(async () => control('Make an image').props.onClick(event));
    expect(chip).toHaveBeenCalledTimes(1);
    expect(tab).toHaveBeenCalledWith('image');
});

test('rights checkbox retains disabled/checked semantics and toggles only when enabled', async () => {
    const change = jest.fn();
    const render = (disabled: boolean) => root.render(<Checkbox checked disabled={disabled} accessibilityLabel="Source rights" accessibilityState={{ checked: true, disabled }} style={{ padding: 12 }} onChange={change}><Text>Source rights</Text></Checkbox>);
    await act(async () => render(true));
    expect(control('Source rights').props.accessibilityState).toEqual({ checked: true, disabled: true });
    expect(RN.StyleSheet.flatten(control('Source rights').props.style)).toMatchObject({ padding: 12, minHeight: 44 });
    await act(async () => control('Source rights').props.onClick?.(event));
    expect(change).not.toHaveBeenCalled();
    await act(async () => render(false));
    await act(async () => control('Source rights').props.onClick(event));
    expect(change).toHaveBeenCalledWith(false);
});

test('fields forward multiline, keyboard and length constraints with trailing content and outer layout', async () => {
    const change = jest.fn();
    await act(async () => root.render(<TextField accessibilityLabel="Seed" value="12" onChangeText={change} multiline keyboardType="number-pad" maxLength={10} containerStyle={{ flex: 1 }} trailing={<Text>Roll</Text>} />));
    const field = control('Seed');
    expect(field.props).toMatchObject({ multiline: true, keyboardType: 'number-pad', maxLength: 10, value: '12' });
    expect(root.container.queryAll(n => n.children.includes('Roll'))).toHaveLength(1);
    expect(root.container.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.flex === 1).length).toBeGreaterThan(0);
});
