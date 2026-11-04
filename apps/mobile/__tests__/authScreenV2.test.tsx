import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import SignIn from '../src/app/sign-in';
import EmailAuth from '../src/app/email';
const mockApple = jest.fn(),
    mockOAuth = jest.fn(),
    mockEmail = jest.fn(),
    mockReplace = jest.fn();
let mockNative = true;
jest.mock('../src/auth/AuthProvider', () => ({
    useAuth: () => ({
        status: 'signedOut',
        appleNativeAvailable: mockNative,
        signInWithApple: mockApple,
        signInWithOAuth: mockOAuth,
        signInWithEmail: mockEmail,
        signUpWithEmail: mockEmail,
    }),
}));
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, Redirect: () => null, useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/components/Logo', () => ({ Logo: () => null }));
jest.mock('../src/auth/TurnstileView', () => ({
    TurnstileView: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'captcha' }),
}));
jest.mock('../src/lib/passkeys', () => ({ passkeyGate: () => false }));
jest.mock('../src/lib/haptics', () => ({ playSelection: jest.fn(), playSuccess: jest.fn(), playError: jest.fn() }));
jest.mock('../src/components/ui/ConsentRow', () => ({
    ConsentRow: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'consent' }),
}));
jest.mock('../src/components/ui', () => {
    const React = require('react'),
        { View, Text } = require('react-native'),
        theme = require('../src/theme');
    const control = (props: any) => React.createElement(View, { ...props, testID: props.provider ?? props.label });
    return {
        Text: jest.requireActual('../src/components/ui/Text').Text,
        Button: control,
        AuthProviderButton: control,
        TextField: control,
        SegmentedControl: control,
        Icon: () => null,
        themedStyles: (fn: Function) => fn(theme.tokensForScheme('dark'), theme.text, 'dark'),
        useThemedStyles: (s: object) => s,
    };
});
void [RN.View, RN.Text, RN.ScrollView, RN.KeyboardAvoidingView];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    jest.clearAllMocks();
});
afterEach(async () => {
    await act(async () => root.unmount());
});
test('sign-in handler gates consent and busy independently of the button', async () => {
    for (const native of [true, false]) {
        mockNative = native;
        await act(async () => root.render(<SignIn key={String(native)} />));
        const apple = () => root.container.queryAll((n) => n.props.testID === 'apple')[0];
        await act(async () => apple().props.onPress());
        expect(mockApple).not.toHaveBeenCalled();
        expect(mockOAuth).not.toHaveBeenCalled();
        await act(async () => root.container.queryAll((n) => n.props.testID === 'consent')[0].props.onChange(true));
        let finish!: () => void;
        const held = new Promise<void>((resolve) => {
            finish = resolve;
        });
        mockApple.mockReturnValue(held);
        mockOAuth.mockReturnValue(held);
        await act(async () => {
            apple().props.onPress();
        });
        await act(async () => {
            apple().props.onPress();
        });
        expect(native ? mockApple : mockOAuth).toHaveBeenCalledTimes(1);
        if (!native) expect(mockOAuth).toHaveBeenCalledWith('apple');
        await act(async () => finish());
        jest.clearAllMocks();
    }
});

test.each([true, false])('email provider keeps busy gating without a consent gate (native=%s)', async (native) => {
    mockNative = native;
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    mockApple.mockReturnValue(held);
    mockOAuth.mockReturnValue(held);
    await act(async () => root.render(<EmailAuth />));
    expect(root.container.queryAll((n) => n.props.testID === 'consent')).toHaveLength(0);
    const apple = () => root.container.queryAll((n) => n.props.testID === 'apple')[0];
    expect(apple().props.consent).toBe(true);
    await act(async () => { apple().props.onPress(); });
    expect(apple().props.busy).toBe(true);
    await act(async () => { apple().props.onPress(); });
    expect(native ? mockApple : mockOAuth).toHaveBeenCalledTimes(1);
    if (!native) expect(mockOAuth).toHaveBeenCalledWith('apple');
    await act(async () => finish());
});
test('email submit requires captcha and prevents duplicate requests without consent', async () => {
    const { t } = require('../src/lib/i18n');
    await act(async () => root.render(<EmailAuth />));
    const control = (key: string) => root.container.queryAll((n) => n.props.testID === t(key))[0];
    expect(control('email.signInCta').props.disabled).toBe(true);
    await act(async () => {
        control('authGate.email').props.onChangeText('person@example.test');
        control('email.passwordTitle').props.onChangeText('password123');
    });
    await act(async () => control('email.signInCta').props.onPress());
    expect(mockEmail).not.toHaveBeenCalled();
    await act(async () => root.container.queryAll((n) => n.props.testID === 'captcha')[0].props.onMessage({ type: 'token', token: 'proof' }));
    expect(control('email.signInCta').props.disabled).toBe(false);
    let finish!: () => void;
    mockEmail.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => { control('email.signInCta').props.onPress(); });
    expect(control('email.signInCta').props.disabled).toBe(true);
    await act(async () => { control('email.signInCta').props.onPress(); });
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockEmail).toHaveBeenCalledWith('person@example.test', 'password123', 'proof');
    await act(async () => finish());
    expect(control('email.signInCta').props.disabled).toBe(true);
});

test('email error announces once when it appears', async () => {
    const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const { t } = require('../src/lib/i18n');
    mockNative = true;
    mockApple.mockRejectedValueOnce(new Error('private auth details'));
    await act(async () => root.render(<EmailAuth />));
    await act(async () => root.container.queryAll(n => n.props.testID === 'apple')[0].props.onPress());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(t('signIn.failed'));
    announce.mockRestore();
});

jest.mock('../src/lib/auth/supabaseAuth', () => ({
    ...jest.requireActual('../src/lib/auth/supabaseAuth'),
    resendSignupEmail: jest.fn(),
}));
const { resendSignupEmail: mockResend, AuthError: MockAuthError } = require('../src/lib/auth/supabaseAuth');
const { t: translate } = require('../src/lib/i18n');
const emailControl = (key: string) => root.container.queryAll(n => n.props.testID === translate(key))[0];
const resendControl = () => root.container.queryAll(n => n.props.accessibilityLabel === translate('email.resendEmailTo', { email: 'person@example.test' }))[0];
const token = async (value = 'fresh') => act(async () => root.container.queryAll(n => n.props.testID === 'captcha')[0].props.onMessage({ type: 'token', token: value }));
const waitCooldown = async () => act(async () => { jest.advanceTimersByTime(60000); });
async function signupPending() {
    jest.useFakeTimers(); mockEmail.mockResolvedValue(false); mockResend.mockResolvedValue(undefined);
    await act(async () => root.render(<EmailAuth />));
    await act(async () => emailControl('email.newHere').props.onPress());
    await act(async () => {
        emailControl('authGate.email').props.onChangeText('person@example.test');
        emailControl('email.passwordTitle').props.onChangeText('password123');
    });
    await token('initial');
    await act(async () => emailControl('email.signUpCta').props.onPress());
}
afterEach(() => jest.useRealTimers());
test('signup shows resend with an address label, starts cooldown, and requires fresh captcha', async () => {
    await signupPending();
    expect(resendControl().props.disabled).toBe(true);
    expect(emailControl('authGate.email').props.value).toBe('person@example.test');
    expect(emailControl('authGate.email').props.editable).toBe(false);
    expect(emailControl('email.passwordTitle')).toBeUndefined();
    await act(async () => resendControl().props.onPress()); expect(mockResend).not.toHaveBeenCalled();
    await waitCooldown();
    await act(async () => resendControl().props.onPress()); expect(mockResend).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.children === translate('email.securityFirst')).length).toBeGreaterThan(0);
    await token('resend-token'); await act(async () => resendControl().props.onPress());
    expect(mockResend).toHaveBeenCalledWith('person@example.test', 'resend-token');
    expect(resendControl().props.disabled).toBe(true);
});
test('resend has one in-flight request even with two immediate taps', async () => {
    await signupPending(); await waitCooldown(); await token();
    let finish!: () => void;
    mockResend.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => { resendControl().props.onPress(); resendControl().props.onPress(); });
    expect(mockResend).toHaveBeenCalledTimes(1);
    expect(resendControl().props.disabled).toBe(true);
    await act(async () => finish());
});
test.each([[429, 'rejected'], [400, 'over_email_send_rate_limit'], [400, 'over_request_rate_limit']])('rate response %s/%s restarts cooldown', async (status, code) => {
    await signupPending(); await waitCooldown(); await token();
    mockResend.mockRejectedValueOnce(new MockAuthError(status, code));
    await act(async () => resendControl().props.onPress());
    expect(resendControl().props.disabled).toBe(true);
    expect(root.container.queryAll(n => n.props.children === translate('email.err.rate')).length).toBeGreaterThan(0);
    await waitCooldown(); expect(resendControl().props.disabled).toBe(false);
});
test('network failure permits retry and the fifth resend caps the attempt', async () => {
    await signupPending(); await waitCooldown();
    mockResend.mockRejectedValue(new MockAuthError(0, 'network'));
    for (let i = 0; i < 5; i++) {
        await token(`cap-${i}`); await act(async () => resendControl().props.onPress());
        expect(resendControl().props.disabled).toBe(i === 4);
    }
    expect(root.container.queryAll(n => n.props.children === translate('email.err.network')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.children === translate('email.resendLimit')).length).toBeGreaterThan(0);
    await act(async () => resendControl().props.onPress()); expect(mockResend).toHaveBeenCalledTimes(5);
});
test('change address returns to signup with an empty password and creates the corrected account', async () => {
    await signupPending(); await token('unused');
    await act(async () => emailControl('email.changeAddress').props.onPress());
    expect(resendControl()).toBeUndefined();
    expect(emailControl('authGate.email').props.editable).toBe(true);
    expect(emailControl('email.passwordTitle').props.value).toBe('');
    await act(async () => {
        emailControl('authGate.email').props.onChangeText('correct@example.test');
        emailControl('email.passwordTitle').props.onChangeText('new-password');
    });
    await act(async () => emailControl('email.signUpCta').props.onPress()); expect(mockEmail).toHaveBeenCalledTimes(1);
    await token('new-signup-token'); await act(async () => emailControl('email.signUpCta').props.onPress());
    expect(mockEmail).toHaveBeenLastCalledWith('correct@example.test', 'new-password', 'new-signup-token');
    expect(mockResend).not.toHaveBeenCalled();
});
test('cooldown announces its start and zero, not every second', async () => {
    const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await signupPending();
    expect(announce).toHaveBeenCalledWith(translate('email.resendIn', { seconds: 60 }));
    announce.mockClear();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(announce).not.toHaveBeenCalled();
    await waitCooldown(); expect(announce).toHaveBeenCalledWith(translate('email.resendReady'));
    announce.mockRestore();
});
