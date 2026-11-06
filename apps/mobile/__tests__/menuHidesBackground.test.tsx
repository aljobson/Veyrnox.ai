import { act } from 'react';
import { View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import TabsLayout from '../src/app/(app)/(tabs)/_layout';
import { setMenuOpen } from '../src/lib/menuOpen';

void View;
jest.mock('expo-router', () => {
    const Tabs = ({ children }: { children: unknown }) => children;
    Tabs.Screen = () => null;
    return { Tabs };
});
jest.mock('../src/components/HeaderChips', () => ({ HeaderRight: () => null }));
jest.mock('../src/components/Logo', () => ({ Logo: () => null }));
jest.mock('../src/components/MenuDrawer', () => ({ MenuButton: () => null }));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); setMenuOpen(false); });
afterEach(async () => { await act(async () => root.unmount()); setMenuOpen(false); });
const wrapper = () => root.container.queryAll(n => 'accessibilityElementsHidden' in n.props)[0];

test('QA-A1: the tab screens are hidden from screen readers only while the side menu is open', async () => {
    await act(async () => root.render(<TabsLayout />));
    expect(wrapper().props.accessibilityElementsHidden).toBe(false);
    expect(wrapper().props.importantForAccessibility).toBe('auto');
    await act(async () => setMenuOpen(true));
    expect(wrapper().props.accessibilityElementsHidden).toBe(true);
    expect(wrapper().props.importantForAccessibility).toBe('no-hide-descendants');
    await act(async () => setMenuOpen(false));
    expect(wrapper().props.accessibilityElementsHidden).toBe(false);
    expect(wrapper().props.importantForAccessibility).toBe('auto');
});
