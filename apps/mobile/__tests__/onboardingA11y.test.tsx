import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AnalyticsChoices } from '../src/components/AnalyticsChoices';
import { LanguageChoice } from '../src/components/LanguageChoice';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
const mockChoose = jest.fn();
jest.mock('../src/lib/analytics', () => ({
    chooseAnalytics: (...args: unknown[]) => mockChoose(...args),
    getAnalyticsChoice: () => null, isAnalyticsEnabled: () => true, readConsent: async () => {}, subscribeConsent: () => () => {},
}));
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => null, loadLanguage: async () => null, saveLanguage: jest.fn(async () => true), saveAccountLanguage: jest.fn(), syncPendingAccountLanguage: jest.fn(async () => {}) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedOut', api: {}, canReloadSession: () => false }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/components/BrandHeader', () => ({ BrandHeader: () => null }));
jest.mock('../src/components/ui', () => {
    const React = jest.requireActual('react');
    return {
        Text: ({ children, ...props }: any) => React.createElement('text', props, children),
        Icon: () => null,
        Card: ({ children }: any) => React.createElement('card', null, children),
        Chip: (props: any) => React.createElement('chip', props),
        Button: (props: any) => React.createElement('button', props),
        themedStyles: (fn: any) => fn(jest.requireActual('../src/theme').tokensForScheme('dark')),
        useThemedStyles: (s: any) => s,
    };
});
void [RN.View, RN.ScrollView];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockChoose.mockReset(); setLocaleFromDevice(['en']); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('a failed consent save is announced as an alert', async () => {
    mockChoose.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<AnalyticsChoices onChosen={jest.fn()} />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert')).toHaveLength(0);
    const allow = root.container.queryAll(n => n.type === 'button' && n.props.label === t('analyticsConsent.allow'))[0];
    await act(async () => { allow.props.onPress(); });
    const alerts = root.container.queryAll(n => n.props.accessibilityRole === 'alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].props.children).toBe(t('analyticsConsent.saveError'));
});

test('languages are radios in a group named by the question, and the pick moves the checked state', async () => {
    await act(async () => root.render(<LanguageChoice returnPath="/" active={['en', 'es']} />));
    const groups = root.container.queryAll(n => n.props.accessibilityRole === 'radiogroup');
    expect(groups).toHaveLength(1);
    expect(groups[0].props.accessibilityLabel).toBe(t('vibe.language.title'));
    const radios = () => groups[0].queryAll(n => n.type === 'chip');
    expect(radios().map(n => [n.props.accessibilityRole, n.props.accessibilityState.checked])).toEqual([['radio', true], ['radio', false]]);
    await act(async () => radios()[1].props.onPress());
    expect(radios().map(n => n.props.accessibilityState.checked)).toEqual([false, true]);
});

test('a list taller than the screen shows a bottom fade until the last row is scrolled into view', async () => {
    await act(async () => root.render(<LanguageChoice returnPath="/" active={['en', 'es']} />));
    const scroll = root.container.queryAll(n => typeof n.props.onContentSizeChange === 'function')[0];
    const fade = () => root.container.queryAll(n => n.props.testID === 'language-more');
    await act(async () => { scroll.props.onLayout({ nativeEvent: { layout: { height: 600 } } }); scroll.props.onContentSizeChange(390, 600); });
    expect(fade()).toHaveLength(0);
    await act(async () => scroll.props.onContentSizeChange(390, 900));
    expect(fade()).toHaveLength(1);
    expect(fade()[0].props.importantForAccessibility).toBe('no-hide-descendants');
    await act(async () => scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 300 } } }));
    expect(fade()).toHaveLength(0);
});
