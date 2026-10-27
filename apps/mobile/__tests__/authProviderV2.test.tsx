import { act, type ReactElement } from 'react';
import { createRoot } from 'test-renderer';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { setEditorMediaOwner } from '../src/lib/editorDeviceMedia';
import { setOwner as setCinemaUploadOwner } from '../src/lib/cinemaUploadStore';
import { bindCacheUser, wipeCache } from '../src/lib/appCache';
import { revokeSession } from '../src/lib/auth/supabaseAuth';
import { AuthProviderButton } from '../src/components/ui/AuthProviderButton';
import * as Apple from 'expo-apple-authentication';
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('../src/components/ui/AppearanceContext', () => ({
    themedStyles: (fn: Function) => fn,
    useThemedStyles: (fn: Function) => fn({}, {}, mockScheme),
    useAppearance: () => ({ scheme: mockScheme }),
}));
jest.mock('../src/components/ui/Button', () => ({ Button: 'MockButton' }));
jest.mock('expo-apple-authentication', () => ({
    isAvailableAsync: jest.fn(async () => false),
    AppleAuthenticationButton: 'NativeApple',
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { BLACK: 2, WHITE: 3 },
}));
function render(nativeAvailable: boolean, consent: boolean, busy: boolean, onPress = jest.fn()) {
    const element = AuthProviderButton({ provider: 'apple', consent, busy, nativeAvailable, onPress }) as ReactElement<any>;
    const callback = nativeAvailable ? element.props.children.props.onPress : element.props.onPress;
    return { element, callback, onPress };
}
test.each([true, false])('Apple callback protects nativeAvailable=%s even when visually bypassed', (native) => {
    for (const [consent, busy] of [
        [false, false],
        [true, true],
        [false, true],
    ]) {
        const { callback, onPress } = render(native, consent, busy);
        callback();
        expect(onPress).not.toHaveBeenCalled();
    }
    const ready = render(native, true, false);
    ready.callback();
    expect(ready.onPress).toHaveBeenCalledTimes(1);
});
test('native blocked wrapper owns accessibility and hides the unconditional native callback', () => {
    const { element } = render(true, false, false);
    expect(element.props).toMatchObject({ pointerEvents: 'none', accessible: true, accessibilityRole: 'button', accessibilityState: { disabled: true }, style: { opacity: 0.4 } });
    expect(element.props.children.props).toMatchObject({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
        cornerRadius: 14,
        style: { height: 52, width: '100%' },
    });
});
test('native Apple button switches style with scheme without a reload', () => {
    mockScheme = 'light';
    expect(render(true, true, false).element.props.children.props.buttonStyle).toBe(Apple.AppleAuthenticationButtonStyle.BLACK);
    mockScheme = 'dark';
    expect(render(true, true, false).element.props.children.props.buttonStyle).toBe(Apple.AppleAuthenticationButtonStyle.WHITE);
});

jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ setEditorMediaOwner: jest.fn(async () => {}) }));
jest.mock('../src/lib/cinemaUploadStore', () => ({ setOwner: jest.fn(async () => {}) }));
jest.mock('../src/lib/oddlingsAccountStore', () => ({ claimLegacyOddlings: jest.fn(async () => {}) }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { setUser: jest.fn(), forget: jest.fn(async () => {}), ensure: jest.fn(async () => {}) } }));
jest.mock('../src/lib/cinemaProgress', () => ({ cinemaProgressIdentity: { setUser: jest.fn() } }));
jest.mock('../src/lib/auth/sessionStore', () => ({ readRefreshToken: jest.fn(async () => null), writeRefreshToken: jest.fn(async () => {}), clearRefreshToken: jest.fn(async () => {}) }));
jest.mock('../src/lib/auth/supabaseAuth', () => ({ ...jest.requireActual('../src/lib/auth/supabaseAuth'), revokeSession: jest.fn(async () => {}) }));
jest.mock('../src/lib/appCache', () => ({ userIdFromToken: (token: string) => token, bindCacheUser: jest.fn(async () => {}), wipeCache: jest.fn(async () => {}), clearExportFiles: jest.fn() }));

test('auth adoption, account change and sign-out fence editor media beside cinema uploads', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); const root = createRoot();
    let auth!: ReturnType<typeof useAuth>;
    function Probe() { auth = useAuth(); return null; }
    try {
        await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
        expect(auth.status).toBe('signedOut');
        const users = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
        for (const user of users) {
            let finish!: () => void;
            jest.mocked(setEditorMediaOwner).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            let adopted = false, adoption!: Promise<void>;
            await act(async () => {
                adoption = auth.adoptSession({ accessToken: user, refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }).then(() => { adopted = true; });
                await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
            });
            expect(setEditorMediaOwner).toHaveBeenLastCalledWith(user); expect(adopted).toBe(false);
            await act(async () => { finish(); await adoption; }); expect(auth.status).toBe('signedIn');
        }
        let finishDrop!: () => void;
        jest.mocked(setEditorMediaOwner).mockImplementationOnce(() => new Promise(resolve => { finishDrop = resolve; }));
        let signOut!: Promise<void>;
        await act(async () => { signOut = auth.signOut(); });
        expect(setEditorMediaOwner).toHaveBeenLastCalledWith(null); expect(auth.status).toBe('signedIn');
        await act(async () => { finishDrop(); await signOut; }); expect(auth.status).toBe('signedOut');
        expect(jest.mocked(setEditorMediaOwner).mock.calls).toEqual([[users[0]], [users[1]], [null]]);
        expect(jest.mocked(setCinemaUploadOwner).mock.calls).toEqual([[users[0]], [users[1]], [null]]);
        for (let i = 0; i < 3; i++) expect(jest.mocked(setCinemaUploadOwner).mock.invocationCallOrder[i]).toBeLessThan(jest.mocked(setEditorMediaOwner).mock.invocationCallOrder[i]);
        expect(bindCacheUser).toHaveBeenLastCalledWith(users[1]); expect(wipeCache).toHaveBeenCalledTimes(1);
        expect(revokeSession).toHaveBeenCalledWith(users[1]);
    } finally { await act(async () => root.unmount()); }
});
