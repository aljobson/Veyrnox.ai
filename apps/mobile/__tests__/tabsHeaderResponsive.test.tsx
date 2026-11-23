import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import TabsLayout from '../src/app/(app)/(tabs)/_layout';
import { t } from '../src/lib/i18n';

let mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockScreenOptions: any;

jest.mock('react-native', () => {
    const actual = jest.requireActual('react-native');
    return Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(actual),
        useWindowDimensions: { enumerable: true, value: () => mockDimensions },
    });
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../src/components/ui/AppearanceContext', () => ({
    ...jest.requireActual('../src/components/ui/AppearanceContext'),
    useAppearance: () => ({ settings: jest.requireActual('../src/theme').DEFAULT_APPEARANCE, scheme: 'dark' }),
}));
jest.mock('../src/lib/menuOpen', () => ({ useMenuOpen: () => false }));
jest.mock('../src/components/HeaderChips', () => ({ HeaderRight: () => null }));
jest.mock('../src/components/MenuDrawer', () => ({ MenuButton: () => null }));
jest.mock('expo-router', () => {
    const React = require('react');
    const Tabs = (props: any) => { mockScreenOptions = props.screenOptions; return React.createElement('tabs', null, props.children); };
    Tabs.Screen = () => null;
    return { Tabs };
});

void [RN.Image, RN.Text, RN.View];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test.each([
    [320, 1, false], [360, 1, false], [390, 1, true],
    [320, 1.6, false], [360, 1.6, false], [390, 1.6, false],
] as const)('%ipx header at %ix text scale keeps its accessible brand and wordmark visibility=%s', async (width, fontScale, wordmark) => {
    mockDimensions = { width, height: 844, scale: 3, fontScale };
    await act(async () => root.render(<TabsLayout />));
    const title = mockScreenOptions({ route: { name: 'index' } }).headerTitle();
    await act(async () => root.render(title));
    expect(root.container.queryAll(node => node.props.accessibilityLabel === 'Veyrnox.ai')).toHaveLength(1);
    expect(root.container.queryAll(node => node.children.includes(t('logo.vEYRNOX')))).toHaveLength(wordmark ? 1 : 0);
});
