import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { HomeBackButton } from '../src/components/HomeBackButton';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';
import { DEFAULT_APPEARANCE, tokensForScheme, type ThemePreference } from '../src/theme';
import { MENU_ICONS } from '../src/lib/menuIcons';
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
void [RN.View, RN.Pressable, RN.Image];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    mockReplace.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); });
test.each<ThemePreference>(['light', 'dark', 'oled'])('back button uses a 44pt themed circle and primary arrow in %s', async (theme) => {
    const settings = { ...DEFAULT_APPEARANCE, theme };
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', settings);
    await act(async () => root.render(<AppearanceContext.Provider value={settings}><HomeBackButton /></AppearanceContext.Provider>));
    const button = root.container.queryAll((n) => n.props.accessibilityRole === 'button')[0];
    expect(RN.StyleSheet.flatten(button.props.style)).toMatchObject({ width: 44, height: 44, borderRadius: 999, backgroundColor: theme === 'light' ? p.bgElevated1 : p.surface });
    const icon = root.container.queryAll((n) => n.props.source === MENU_ICONS.arrowLeft)[0];
    expect(icon).toBeDefined();
    expect(RN.StyleSheet.flatten(icon.props.style).tintColor).toBe(p.textPrimary);
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockReplace).toHaveBeenCalledWith('/');
});
