import { act } from 'react';
import { Text } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useAuth } from '../src/auth/AuthProvider';
import { MfaGate } from '../src/components/account/MfaGate';
import { MfaCard } from '../src/components/account/MfaCard';
import { fetchProfile, verifyFactor } from '../src/lib/auth/accountCalls';
import { AuthError } from '../src/lib/auth/supabaseAuth';
import { markMfaCleared } from '../src/lib/mfaCheck';
import { t } from '../src/lib/i18n';
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../src/lib/auth/accountCalls', () => ({ fetchProfile: jest.fn(), verifyFactor: jest.fn() }));
jest.mock('../src/lib/mfaCheck', () => ({ knownMfaEnrolment: jest.fn(async () => true), rememberMfaEnrolment: jest.fn(), mfaClearedFor: () => false, markMfaCleared: jest.fn() }));
const jwt = (aal = 'aal1') => `h.${btoa(JSON.stringify({ sub: 'A', aal }))}.s`;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let root: Root, gen: number, adopt: jest.Mock;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); gen = 1; root = createRoot();
    const tokens = jest.fn(async () => jwt());
    adopt = jest.fn(async (_s, expected) => { if (expected !== gen) throw new AuthError(401, 'account_changed'); });
    jest.mocked(useAuth).mockReturnValue({ status: 'signedIn', generation: gen, sessionGeneration: () => gen, getAccessToken: tokens,
        beginSessionTask: () => { const start = gen; return { gen: start, user: 'A', current: () => gen === start, tokens }; }, adoptSession: adopt } as any);
    jest.mocked(fetchProfile).mockResolvedValue({ email: 'a', provider: 'email', factors: [{ id: 'f', status: 'verified', friendlyName: 'auth' }] });
});
afterEach(async () => { await act(async () => root.unmount()); });
async function start(card: boolean) {
    await act(async () => root.render(card ? <MfaCard /> : <MfaGate><Text>Inside</Text></MfaGate>));
    const field = root.container.queryAll(n => n.props.onChangeText)[0]; await act(async () => field.props.onChangeText('123456'));
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t(card ? 'acct.mfa.unlock' : 'acct.mfa.verify'))[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
test.each([false, true])('MFA ignores code verified after account changed (card=%s)', async card => {
    const gate = deferred<any>(); jest.mocked(verifyFactor).mockReturnValueOnce(gate.promise); await start(card);
    gen++; await act(async () => gate.resolve({ access_token: jwt('aal2'), refresh_token: 'r', expires_in: 3600 }));
    expect(adopt).not.toHaveBeenCalled(); expect(markMfaCleared).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes('Inside') || n.props.accessibilityRole === 'alert')).toHaveLength(0);
});
test('MfaGate rechecks after adoptSession resolves without rejecting a switch', async () => {
    jest.mocked(verifyFactor).mockResolvedValue({ access_token: jwt('aal2'), refresh_token: 'r', expires_in: 3600 } as any);
    const gate = deferred<void>(); adopt.mockImplementationOnce(async () => { await gate.promise; gen++; }); await start(false);
    await act(async () => gate.resolve()); expect(markMfaCleared).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes('Inside'))).toHaveLength(0);
});
