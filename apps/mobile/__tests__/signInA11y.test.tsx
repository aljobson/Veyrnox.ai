/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted, so they cannot use imports. */
import { act, type ReactElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AuthProviderButton } from '../src/components/ui/AuthProviderButton';
import SignIn from '../src/app/sign-in';
import { t } from '../src/lib/i18n';
jest.mock('../src/components/ui/AppearanceContext', () => {
    const theme = require('../src/theme');
    return {
        themedStyles: (fn: Function) => fn,
        useThemedStyles: (fn: Function) => fn(theme.tokensForScheme('dark'), theme.text, 'dark'),
        useAppearance: () => ({ scheme: 'dark' }),
    };
});
jest.mock('expo-apple-authentication', () => ({
    AppleAuthenticationButton: 'NativeApple',
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { BLACK: 2, WHITE: 3 },
}));
jest.mock('../src/auth/AuthProvider', () => ({
    useAuth: () => ({ status: 'signedOut', appleNativeAvailable: false, signInWithApple: jest.fn(), signInWithOAuth: jest.fn(), signInWithEmail: jest.fn() }),
}));
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, Redirect: () => null, useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 54, bottom: 0 }) }));
jest.mock('../src/components/BrandIntro', () => ({ BrandIntro: () => null }));
jest.mock('../src/components/SignupOffer', () => ({ SignupOffer: () => null }));
jest.mock('../src/lib/passkeys', () => ({ passkeyGate: () => false }));
jest.mock('../src/lib/haptics', () => ({ playSelection: jest.fn() }));
jest.mock('../src/components/ui/ConsentRow', () => ({
    ConsentRow: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'consent' }),
}));
jest.mock('../src/components/ui', () => {
    const React = require('react'),
        { View } = require('react-native');
    const control = (props: any) => React.createElement(View, { ...props, testID: props.provider ?? props.label });
    return {
        Text: jest.requireActual('../src/components/ui/Text').Text,
        Button: control,
        AuthProviderButton: control,
        Icon: () => null,
        themedStyles: (fn: Function) => fn,
        useThemedStyles: (fn: Function) => fn(require('../src/theme').tokensForScheme('dark'), require('../src/theme').text, 'dark'),
    };
});
void RN.View;

describe('AuthProviderButton hint', () => {
    const render = (provider: 'apple' | 'google', consent: boolean, busy = false, nativeAvailable = false) =>
        AuthProviderButton({ provider, consent, busy, nativeAvailable, onPress: jest.fn() }) as ReactElement<any>;
    test.each([
        ['apple', false],
        ['apple', true],
        ['google', false],
    ] as const)('%s (native=%s) says why it is dimmed until the box is ticked', (provider, native) => {
        expect(render(provider, false, false, native).props.accessibilityHint).toBe(t('signIn.tickFirst'));
        expect(render(provider, true, false, native).props.accessibilityHint).toBeUndefined();
        // Busy is not a consent problem, so the hint does not appear for it.
        expect(render(provider, true, true, native).props.accessibilityHint).toBeUndefined();
    });
});

describe('sign-in screen', () => {
    let root: Root;
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        root = createRoot();
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        jest.restoreAllMocks();
    });
    const textNode = (key: string) => root.container.queryAll((n) => n.type === 'Text' && n.children.includes(t(key)))[0];

    test('the title is the header, not the kicker', async () => {
        await act(async () => root.render(<SignIn />));
        expect(textNode('signIn.title').props.accessibilityRole).toBe('header');
        expect(textNode('signIn.kicker').props.accessibilityRole).toBeUndefined();
    });

    test('the promise group reads the visible lines, not a different summary', async () => {
        await act(async () => root.render(<SignIn />));
        const group = root.container.queryAll((n) => n.props.accessible === true && n.type === 'View')[0];
        expect(group.props.accessibilityLabel).toBeUndefined();
        for (const key of ['signIn.photo', 'signIn.video', 'signIn.idea']) expect(group.queryAll((n) => n.type === 'Text' && n.children.includes(t(key)))).toHaveLength(1);
    });

    test('ticking the box announces the status line once', async () => {
        const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
        await act(async () => root.render(<SignIn />));
        expect(textNode('signIn.tickFirst').props.accessibilityLiveRegion).toBe('polite');
        expect(announce).not.toHaveBeenCalled();
        await act(async () => root.container.queryAll((n) => n.props.testID === 'consent')[0].props.onChange(true));
        expect(announce).toHaveBeenCalledTimes(1);
        expect(announce).toHaveBeenCalledWith(t('signIn.ready'));
    });

    test('scrolled content stays below the status bar', async () => {
        await act(async () => root.render(<SignIn />));
        const scroll = root.container.queryAll((n) => n.type === 'RCTScrollView' || n.props.keyboardShouldPersistTaps === 'handled')[0];
        const frame = scroll.parent!;
        expect(RN.StyleSheet.flatten(frame.props.style)).toMatchObject({ paddingTop: 54 });
        expect(RN.StyleSheet.flatten(frame.props.style).backgroundColor).toBeTruthy();
        expect(RN.StyleSheet.flatten(scroll.props.contentContainerStyle).paddingTop).toBeLessThan(54);
    });
});
