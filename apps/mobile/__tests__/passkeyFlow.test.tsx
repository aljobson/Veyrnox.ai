import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as native from 'react-native-passkeys';
import * as auth from '../src/auth/AuthProvider';
import { TurnstileView } from '../src/auth/TurnstileView';
import { PasskeysCard } from '../src/components/account/PasskeysCard';
import SignIn from '../src/app/sign-in';
import PasskeyAuth from '../src/app/passkey';
import { addPasskey, fetchPasskeys, passkeysServerAvailable } from '../src/lib/passkeys';
import { AuthError, passkeySignInOptions, passkeySignInVerify } from '../src/lib/auth/supabaseAuth';
import { readRefreshToken, writeRefreshToken } from '../src/lib/auth/sessionStore';
import { bindCacheUser } from '../src/lib/appCache';
import { aalFromToken, needsChallenge } from '../src/lib/mfa';
import { t } from '../src/lib/i18n';

jest.mock('react-native-passkeys', () => ({ isSupported: jest.fn(() => true), create: jest.fn(), get: jest.fn() }));
jest.mock('expo-router', () => ({
    Link: ({ children }: { children: React.ReactNode }) => children,
    Redirect: () => null,
    useRouter: () => ({ back: jest.fn(), replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), openBrowserAsync: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/lib/auth/pkce', () => ({}));
jest.mock('../src/components/MascotWordmark', () => ({ MascotWordmark: () => null }));
jest.mock('../src/auth/TurnstileView', () => ({ TurnstileView: jest.fn(() => null) }));
jest.mock('../src/lib/api', () => ({ createApiClient: () => ({}) }));
jest.mock('../src/lib/appCache', () => ({ bindCacheUser: jest.fn(), userIdFromToken: () => 'passkey-user', wipeCache: jest.fn() }));
jest.mock('../src/lib/cinemaProgress', () => ({ cinemaProgressIdentity: { setUser: jest.fn() } }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { setUser: jest.fn(), forget: jest.fn(), ensure: jest.fn() } }));
jest.mock('../src/lib/auth/sessionStore', () => ({ writeRefreshToken: jest.fn(), readRefreshToken: jest.fn(), clearRefreshToken: jest.fn() }));
jest.mock('../src/lib/auth/supabaseAuth', () => ({ ...jest.requireActual('../src/lib/auth/supabaseAuth'), passkeySignInOptions: jest.fn(), passkeySignInVerify: jest.fn() }));
jest.mock('../src/lib/passkeys', () => ({ ...jest.requireActual('../src/lib/passkeys'), addPasskey: jest.fn(), fetchPasskeys: jest.fn(), passkeysServerAvailable: jest.fn() }));

void [RN.ActivityIndicator, RN.Pressable, RN.ScrollView, RN.StyleSheet, RN.Text, RN.TextInput, RN.View];
let root: Root;
let authSpy: jest.SpyInstance;
let signIn: jest.Mock;
let context: ReturnType<typeof auth.useAuth>;
const originalOS = RN.Platform.OS;
const originalIos = process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
const originalAndroid = process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED;

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'ios' });
    process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = 'true';
    delete process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED;
    jest.mocked(native.isSupported).mockReturnValue(true);
    jest.mocked(readRefreshToken).mockResolvedValue(null);
    jest.mocked(fetchPasskeys).mockResolvedValue([]);
    jest.mocked(passkeysServerAvailable).mockResolvedValue(true);
    jest.mocked(addPasskey).mockResolvedValue({ id: 'new-passkey' });
    signIn = jest.fn(async () => false);
    authSpy = jest.spyOn(auth, 'useAuth').mockReturnValue({ status: 'signedOut', getAccessToken: async () => 'token', signInWithPasskey: signIn } as unknown as ReturnType<typeof auth.useAuth>);
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    authSpy.mockRestore();
});
afterAll(() => {
    Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: originalOS });
    if (originalIos === undefined) delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED; else process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = originalIos;
    if (originalAndroid === undefined) delete process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED; else process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED = originalAndroid;
});

async function render(element: React.ReactElement) { await act(async () => { root.render(element); }); }
function controls(label: string) { return root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label); }
function control(label: string): TestInstance { const matches = controls(label); expect(matches).toHaveLength(1); return matches[0]; }
function texts(value: string) { return root.container.queryAll(node => node.children.includes(value)); }
async function press(label: string) { await act(async () => { control(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); }); }
function captchaProps() { const calls = jest.mocked(TurnstileView).mock.calls; return calls[calls.length - 1][0]; }
async function token() { await act(async () => captchaProps().onMessage({ type: 'token', token: 'single-use' })); }

// The real native wrapper is mocked only at its library boundary; platform gates remain real.
test('flag-off card keeps list/remove and addLater without enrolment controls', async () => {
    delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
    jest.mocked(fetchPasskeys).mockResolvedValue([{ id: 'pk_12345678', name: 'Existing', createdAt: null, lastUsedAt: null }]);
    await render(<PasskeysCard />);
    expect(texts(t('pk.addLater'))).toHaveLength(1);
    expect(controls(t('passkey.add'))).toHaveLength(0);
    expect(control(t('pk.removeNamed', { name: 'Existing' }))).toBeDefined();
    expect(addPasskey).not.toHaveBeenCalled();
});

test('enrolment success disables controls while busy, clears name and reloads list', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(addPasskey).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(<PasskeysCard />);
    const field = () => root.container.queryAll(node => node.props.accessibilityLabel === t('passkey.nameLabel'))[0];
    await act(async () => { field().props.onChangeText('My phone'); });
    expect(field().props.maxLength).toBe(64);
    await press(t('passkey.add'));
    expect(control(t('passkey.add')).props.accessibilityState.disabled).toBe(true);
    expect(field().props.editable).toBe(false);
    expect(texts(t('passkey.busy'))).toHaveLength(1);
    await act(async () => { finish({ id: 'new' }); });
    expect(addPasskey).toHaveBeenCalledWith(expect.any(Function), 'My phone');
    expect(fetchPasskeys).toHaveBeenCalledTimes(2);
    expect(field().props.value).toBe('');
    expect(texts(t('passkey.added'))).toHaveLength(1);
    expect(texts(t('pk.addLater'))).toHaveLength(0);
});

test('enrolment cancellation leaves no status and does not reload', async () => {
    jest.mocked(addPasskey).mockResolvedValueOnce(null);
    await render(<PasskeysCard />);
    await press(t('passkey.add'));
    expect(fetchPasskeys).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll(node => node.props.accessibilityLiveRegion === 'polite')).toHaveLength(0);
});

test('enrolment action rechecks the gate before doing anything', async () => {
    await render(<PasskeysCard />);
    process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = 'false';
    await press(t('passkey.add'));
    expect(addPasskey).not.toHaveBeenCalled();
});

test.each(['flag', 'unsupported', 'android'])('sign-in hides passkey entry when %s is closed', async reason => {
    if (reason === 'flag') delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
    if (reason === 'unsupported') jest.mocked(native.isSupported).mockReturnValue(false);
    if (reason === 'android') Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'android' });
    await render(<SignIn />);
    expect(controls(t('passkey.signIn'))).toHaveLength(0);
});

test('iOS entry is enabled only after agreement', async () => {
    await render(<SignIn />);
    expect(control(t('passkey.signIn')).props.accessibilityState.disabled).toBe(true);
    const box = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox')[0];
    await act(async () => { box.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
    expect(control(t('passkey.signIn')).props.accessibilityState.disabled).toBe(false);
});

test.each(['flag', 'android', 'unsupported'])('direct route with %s gate closed starts no CAPTCHA or requests', async reason => {
    if (reason === 'flag') delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
    if (reason === 'android') Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'android' });
    if (reason === 'unsupported') jest.mocked(native.isSupported).mockReturnValue(false);
    await render(<PasskeyAuth />);
    expect(TurnstileView).not.toHaveBeenCalled();
    expect(passkeysServerAvailable).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
    expect(texts(t('passkey.err.off'))).toHaveLength(1);
    expect(control(t('public.vey.back'))).toBeDefined();
});

test.each(['failed', 'cancelled', 'success', 'disabled'])('route consumes captcha after %s attempt', async outcome => {
    if (outcome === 'failed') signIn.mockRejectedValueOnce(new AuthError(403, 'origin_rejected'));
    if (outcome === 'success') signIn.mockResolvedValueOnce(true);
    if (outcome === 'disabled') jest.mocked(passkeysServerAvailable).mockResolvedValueOnce(false);
    await render(<PasskeyAuth />);
    expect(control(t('passkey.continue')).props.accessibilityState.disabled).toBe(true);
    expect(captchaProps().resetKey).toBe(0);
    await token();
    expect(control(t('passkey.continue')).props.accessibilityState.disabled).toBe(false);
    await press(t('passkey.continue'));
    expect(passkeysServerAvailable).toHaveBeenCalledTimes(1);
    if (outcome === 'disabled') expect(signIn).not.toHaveBeenCalled();
    else expect(signIn).toHaveBeenCalledWith('single-use');
    expect(captchaProps().resetKey).toBe(1);
    expect(control(t('passkey.continue')).props.accessibilityState.disabled).toBe(true);
    if (outcome === 'failed') expect(texts(t('passkey.err.refused'))).toHaveLength(1);
    if (outcome === 'disabled') expect(texts(t('passkey.err.off'))).toHaveLength(1);
    if (outcome === 'cancelled') expect(root.container.queryAll(node => node.props.accessibilityLiveRegion === 'polite')).toHaveLength(0);
});

function Probe() { context = auth.useAuth(); return null; }
async function provider() {
    authSpy.mockRestore();
    await render(<auth.AuthProvider><Probe /></auth.AuthProvider>);
}
const credential = { id: 'id', rawId: 'raw', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'client', authenticatorData: 'data', signature: 'sig' } };
const accessToken = `header.${btoa(JSON.stringify({ sub: 'passkey-user', aal: 'aal1' }))}.signature`;

test('provider adopts passkey session through secure store/cache and aal1 still needs MFA', async () => {
    jest.mocked(passkeySignInOptions).mockResolvedValue({ challenge_id: 'challenge-id', options: { challenge: 'challenge' } });
    jest.mocked(native.get).mockResolvedValue(credential as never);
    jest.mocked(passkeySignInVerify).mockResolvedValue({ accessToken, refreshToken: 'refresh-passkey', expiresAt: Date.now() + 3600000 });
    await provider();
    await act(async () => { expect(await context.signInWithPasskey('captcha')).toBe(true); });
    expect(passkeySignInOptions).toHaveBeenCalledWith('captcha');
    expect(native.get).toHaveBeenCalledWith({ challenge: 'challenge' });
    expect(passkeySignInVerify).toHaveBeenCalledWith('challenge-id', credential);
    expect(writeRefreshToken).toHaveBeenCalledWith('refresh-passkey');
    expect(bindCacheUser).toHaveBeenCalledWith('passkey-user');
    expect(context.status).toBe('signedIn');
    expect(await context.getAccessToken()).toBe(accessToken);
    expect(needsChallenge({ factors: [{ id: 'totp', status: 'verified', friendlyName: 'Authenticator' }] }, aalFromToken(accessToken))).toBe(true);
});

test.each(['flag', 'android', 'unsupported'])('provider action with %s gate closed starts no authentication', async reason => {
    if (reason === 'flag') delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
    if (reason === 'android') Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'android' });
    if (reason === 'unsupported') jest.mocked(native.isSupported).mockReturnValue(false);
    await provider();
    expect(await context.signInWithPasskey('captcha')).toBe(false);
    expect(passkeySignInOptions).not.toHaveBeenCalled();
    expect(native.get).not.toHaveBeenCalled();
    expect(writeRefreshToken).not.toHaveBeenCalled();
});

test('provider cancellation sends no verification and stores no session', async () => {
    jest.mocked(passkeySignInOptions).mockResolvedValue({ challenge_id: 'id', options: { challenge: 'c' } });
    jest.mocked(native.get).mockResolvedValue(null);
    await provider();
    expect(await context.signInWithPasskey('captcha')).toBe(false);
    expect(passkeySignInVerify).not.toHaveBeenCalled();
    expect(writeRefreshToken).not.toHaveBeenCalled();
    expect(context.status).toBe('signedOut');
});

test('provider rejects malformed sign-in options before ceremony', async () => {
    jest.mocked(passkeySignInOptions).mockResolvedValue({ challenge_id: 'id', options: {} });
    await provider();
    await expect(context.signInWithPasskey('captcha')).rejects.toMatchObject({ code: 'malformed_options' });
    expect(native.get).not.toHaveBeenCalled();
    expect(writeRefreshToken).not.toHaveBeenCalled();
});
