import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { Button, Chip, SegmentedControl, Text } from '../src/components/ui';
import { APP_CATALOGS, setLocaleFromDevice, t } from '../src/lib/i18n';
import TabsLayout from '../src/app/(app)/(tabs)/_layout';
import { CreditsChip } from '../src/components/HeaderChips';
import { DEFAULT_APPEARANCE } from '../src/theme';

declare const require: (id: string) => any;
jest.mock('react-native', () => {
    const actual = jest.requireActual('react-native');
    return Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(actual),
        useWindowDimensions: { enumerable: true, value: () => ({ width: 320, height: 640, scale: 1, fontScale: 1 }) },
    });
});
const locales = Object.keys(APP_CATALOGS) as (keyof typeof APP_CATALOGS)[];
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/components/ui/AppearanceContext', () => ({
    ...jest.requireActual('../src/components/ui/AppearanceContext'),
    useAppearance: () => ({ settings: jest.requireActual('../src/theme').DEFAULT_APPEARANCE, scheme: 'dark' }),
}));
jest.mock('expo-router', () => {
    const React = require('react');
    const Tabs = ({ children }: any) => React.createElement('tabs', null, children);
    Tabs.Screen = ({ options }: any) => options.tabBarLabel({ color: 'white' });
    return { Tabs, useRouter: () => ({ push: jest.fn() }), usePathname: () => '/' };
});
jest.mock('../src/components/MenuDrawer', () => ({ MenuButton: () => null }));
jest.mock('../src/components/Logo', () => ({ Logo: () => null }));
void [RN.View, RN.Text, RN.Pressable, RN.Image, RN.ActivityIndicator, DEFAULT_APPEARANCE];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); });
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const nativeText = () => root.container.queryAll(n => n.type === 'Text' && !n.props.accessibilityElementsHidden);
function expectFit(node: TestInstance, lines: number) {
    expect(node.props.numberOfLines).toBe(lines);
    expect(node.props.adjustsFontSizeToFit).toBe(true);
    expect(node.props.minimumFontScale).toBe(0.85);
    expect(node.props.allowFontScaling).toBe(true);
}

test.each(locales)('%s: every length flag has wrap/shrink protection in fixed-width primitives at default text size', async locale => {
    setLocaleFromDevice([locale]);
    const flags: { id: string; translation: string }[] = require(`../src/lib/i18n/review/${locale}-length.json`);
    expect(flags.length).toBeGreaterThan(0);
    // Deliberately exercise the entire report, including prose: dynamic option-label
    // tables cannot accidentally fall outside a hand-picked list of control keys.
    for (const kind of ['button', 'chip', 'segment', 'richButton', 'richChip'] as const) {
        await act(async () => root.render(<RN.View style={{ width: 320 }}>
            {flags.map(({ id, translation: label }) => <RN.View key={id} style={{ width: 100 }}>
                {kind === 'button' ? <Button size="sm" label={label} icon="star" /> :
                    kind === 'chip' ? <Chip fullWidth label={label} onPress={() => {}} /> :
                    kind === 'segment' ? <SegmentedControl options={[{ value: id, label }]} value={id} onChange={() => {}} /> :
                    kind === 'richButton' ? <Button label={label}><Text variant="footnote">{label}</Text></Button> :
                    <Chip fullWidth label={label}><Text variant="caption">{label}</Text></Chip>}
            </RN.View>)}
        </RN.View>));
        const labels = nativeText();
        expect(labels).toHaveLength(flags.length);
        labels.forEach((node, index) => {
            expect(textOf(node)).toBe(flags[index].translation);
            expectFit(node, 2);
            expect(RN.StyleSheet.flatten(node.props.style).flexShrink).toBe(1);
            expect(RN.StyleSheet.flatten(node.props.style).fontSize).toBeGreaterThan(0);
        });
    }
}, 20_000); // Renders every length-flagged string; slow on CI runners.

test.each(locales)('%s: actual bottom tabs and header captions retain one line with bounded shrink', async locale => {
    setLocaleFromDevice([locale]);
    await act(async () => root.render(<><TabsLayout /><CreditsChip /></>));
    const labels = nativeText();
    for (const key of ['tabs.explore', 'tabs.create', 'tabs.editor', 'tabs.library', 'tabs.publish']) {
        const node = labels.find(n => textOf(n) === t(key));
        expect(node).toBeDefined();
        expectFit(node!, 1);
    }
    const balance = labels.find(n => textOf(n) === '100');
    expect(balance).toBeDefined();
    expectFit(balance!, 1);
});

test('German Create price chip keeps Jeder Preis and permits two lines and 0.85 shrinking', async () => {
    setLocaleFromDevice(['de']);
    await act(async () => root.render(<RN.View style={{ width: 80 }}><Chip fullWidth label={t('create.tier.all')} onPress={() => {}} /></RN.View>));
    expect(textOf(nativeText()[0])).toBe('Jeder Preis');
    expectFit(nativeText()[0], 2);
});

test('English controls and tabs retain their original text layout defaults', async () => {
    setLocaleFromDevice(['en']);
    await act(async () => root.render(<><Button label="Continue" /><Chip label="Any price" /><SegmentedControl options={[{ value: 'all', label: 'All' }]} value="all" onChange={() => {}} /><TabsLayout /></>));
    for (const node of nativeText()) {
        expect(node.props.adjustsFontSizeToFit).toBeUndefined();
        expect(node.props.minimumFontScale).toBeUndefined();
        expect(node.props.numberOfLines).toBe(['Explore', 'Create', 'Editor', 'Library', 'Publish'].includes(textOf(node)) ? 1 : undefined);
    }
});

test('explicit English binding text keeps its original layout inside translated controls', async () => {
    setLocaleFromDevice(['ar']);
    await act(async () => root.render(<Button label="Binding fixture"><Text variant="caption" numberOfLines={1} accessibilityLanguage="en">Binding fixture</Text></Button>));
    const node = nativeText()[0];
    expect(node.props.numberOfLines).toBe(1);
    expect(node.props.adjustsFontSizeToFit).toBeUndefined();
    expect(node.props.minimumFontScale).toBeUndefined();
});
