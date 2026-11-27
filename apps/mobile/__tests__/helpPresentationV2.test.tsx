import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Help from '../src/app/(app)/help';
import { AppearanceContext } from '../src/components/ui';
import { LEGAL_LINKS, SUPPORT_EMAIL } from '../src/lib/account';
import { t } from '../src/lib/i18n';
import { rawText } from '../src/lib/i18n/translate';
import { DEFAULT_APPEARANCE, VIVID_HUES, vividHue } from '../src/theme';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
    Stack: { Screen: () => null },
    Link: ({ children, href }: any) => require('react').cloneElement(children, { onPress: () => mockPush(href) }),
}));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    root = createRoot();
    await act(async () => root.render(<AppearanceContext.Provider value={{ ...DEFAULT_APPEARANCE, theme: 'dark' }}><Help /></AppearanceContext.Provider>));
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

const control = (label: string) => root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === rawText(label))[0];
const press = async (label: string) => act(async () => control(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));

test('Help uses the full vivid palette for every destination', () => {
    const fills = new Set(VIVID_HUES.map(hue => vividHue(hue, 'dark').fill));
    const cards = root.container.queryAll(node => fills.has(RN.StyleSheet.flatten(node.props.style)?.backgroundColor));
    expect(cards).toHaveLength(5 + LEGAL_LINKS.length);
    expect(new Set(cards.map(node => RN.StyleSheet.flatten(node.props.style).backgroundColor))).toEqual(fills);
});

test('Help cards retain native routes and the fixed support mail action', async () => {
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue();
    await press(t('helpGuides.title'));
    await press(t('help.openchat'));
    await press(LEGAL_LINKS[0].label);
    expect(mockPush.mock.calls.map(([route]) => route)).toEqual(['/guides', '/chat', LEGAL_LINKS[0].route]);
    await press(t('help.emailsupport', { value1: SUPPORT_EMAIL }));
    expect(open).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`);
});
