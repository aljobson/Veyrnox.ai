import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
declare const require: (name: string) => any;
declare const __dirname: string;
const { execFileSync } = require('node:child_process');
const path = require('node:path');
import { useAuth } from '../src/auth/AuthProvider';
import * as calls from '../src/lib/auth/accountCalls';
import * as keys from '../src/lib/passkeys';
import { AuthError } from '../src/lib/auth/supabaseAuth';
import { knownMfaEnrolment, markMfaCleared, rememberMfaEnrolment } from '../src/lib/mfaCheck';
import { t } from '../src/lib/i18n';
import { MfaCard } from '../src/components/account/MfaCard';
import { GATE_TIMEOUT_MS, MfaGate } from '../src/components/account/MfaGate';
import { PasswordCard } from '../src/components/account/PasswordCard';
import { PasskeysCard } from '../src/components/account/PasskeysCard';
import { DevicesCard } from '../src/components/account/DevicesCard';
import { GrantsCard } from '../src/components/account/GrantsCard';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../src/lib/auth/accountCalls', () => ({ fetchProfile: jest.fn(), enrollTotp: jest.fn(), verifyFactor: jest.fn(), unenrollFactor: jest.fn(), requestPasswordCode: jest.fn(), changePassword: jest.fn(), revokeSessions: jest.fn(), fetchGrantsRaw: jest.fn(), revokeGrant: jest.fn() }));
jest.mock('../src/lib/passkeys', () => ({ ...jest.requireActual('../src/lib/passkeys'), fetchPasskeys: jest.fn(), addPasskey: jest.fn(), removePasskey: jest.fn(), passkeyGate: jest.fn(() => true) }));
jest.mock('../src/lib/mfaCheck', () => ({ markMfaCleared: jest.fn(), mfaClearedFor: jest.fn(() => false), knownMfaEnrolment: jest.fn(async () => null), rememberMfaEnrolment: jest.fn(async () => {}) }));
// Read the same fixtures used by the dev server without introducing a runtime dependency on dev code.
const fixturePath = path.resolve(__dirname, '../dev/mockSecurityFixtures.mjs');
const fixture = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import * as f from ${JSON.stringify(fixturePath)}; console.log(JSON.stringify({ ...f.createSecurityFixtures(), secret: f.SECURITY_SECRET, uri: f.SECURITY_URI, tokens: f.securityTokens('aal2'), initial: f.securityTokens('aal1') }));`], { encoding: 'utf8' }));
void [RN.ActivityIndicator, RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.StyleSheet];
let root: Root;
let token: string;
const getAccessToken = jest.fn(async () => token);
const adoptSession = jest.fn(async (session) => { token = session.accessToken; });
const signOut = jest.fn(async () => {});
let alert: jest.SpyInstance;
const profile = (factors = fixture.factors) => ({ email: 'creator@veyrnox.local', provider: 'email', factors: factors.map((f: any) => ({ id: f.id, status: f.status, friendlyName: f.friendly_name })) });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    token = fixture.initial.access_token;
    jest.mocked(useAuth).mockReturnValue({ status: 'signedIn', generation: 0, sessionGeneration: () => 0, beginSessionTask: () => ({ gen: 0, user: '00000000-0000-4000-8000-000000000001', current: () => true, tokens: getAccessToken }), getAccessToken, adoptSession, signOut } as any);
    jest.mocked(calls.fetchProfile).mockResolvedValue(profile());
    jest.mocked(calls.enrollTotp).mockResolvedValue({ factorId: 'mock-enrolment', secret: fixture.secret, uri: fixture.uri });
    jest.mocked(calls.verifyFactor).mockResolvedValue(fixture.tokens);
    jest.mocked(calls.unenrollFactor).mockResolvedValue();
    jest.mocked(calls.requestPasswordCode).mockResolvedValue();
    jest.mocked(calls.changePassword).mockResolvedValue();
    jest.mocked(calls.revokeSessions).mockResolvedValue();
    jest.mocked(calls.fetchGrantsRaw).mockResolvedValue({ grants: fixture.grants });
    jest.mocked(calls.revokeGrant).mockResolvedValue();
    jest.mocked(keys.fetchPasskeys).mockResolvedValue(keys.parsePasskeys({ passkeys: fixture.passkeys }));
    jest.mocked(keys.passkeyGate).mockReturnValue(true);
    jest.mocked(keys.addPasskey).mockResolvedValue({ id: 'new-passkey' });
    jest.mocked(keys.removePasskey).mockResolvedValue();
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
async function render(element: React.ReactElement) { await act(async () => root.render(element)); }
const controls = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
const control = (label: string) => { const found = controls(label); expect(found).toHaveLength(1); return found[0]; };
const field = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onChangeText)[0];
const texts = (value: string) => root.container.queryAll(n => n.children.includes(value));
async function press(label: string) { await act(async () => control(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function input(label: string, value: string) { await act(async () => field(label).props.onChangeText(value)); }
const disabled = (...labels: string[]) => labels.forEach(label => expect(control(label).props.accessibilityState.disabled).toBe(true));
async function confirm(cancel = false) { const buttons = alert.mock.calls.at(-1)![2]; await act(async () => buttons.find((b: any) => b.style === (cancel ? 'cancel' : 'destructive')).onPress?.()); }
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('TOTP enrolment keeps secret, otpauth action, one-time-code field, wrong-code recovery and adoption', async () => {
    jest.mocked(calls.fetchProfile).mockResolvedValue(profile([]));
    const enrolling = deferred<calls.Enrolment>();
    jest.mocked(calls.enrollTotp).mockReturnValueOnce(enrolling.promise);
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue();
    await render(<MfaCard />);
    await press(t('acct.mfa.setup'));
    disabled(t('acct.mfa.setup'));
    expect(calls.enrollTotp).toHaveBeenCalledWith(getAccessToken, expect.stringMatching(/^Veyrnox/));
    await act(async () => enrolling.resolve({ factorId: 'mock-enrolment', secret: fixture.secret, uri: fixture.uri }));
    expect(texts(fixture.secret)).toHaveLength(1);
    await press(t('acct.mfa.openApp'));
    expect(open).toHaveBeenCalledWith(fixture.uri);
    expect(field(t('acct.mfa.code')).props).toMatchObject({ autoComplete: 'one-time-code', textContentType: 'oneTimeCode', maxLength: 6, keyboardType: 'number-pad' });
    disabled(t('acct.mfa.confirm'));
    await input(t('acct.mfa.code'), '12a3');
    expect(field(t('acct.mfa.code')).props.value).toBe('123');
    disabled(t('acct.mfa.confirm'));
    await input(t('acct.mfa.code'), '654321');
    jest.mocked(calls.verifyFactor).mockRejectedValueOnce(new AuthError(400, 'mfa_verification_failed'));
    await press(t('acct.mfa.confirm'));
    expect(calls.verifyFactor).toHaveBeenLastCalledWith(getAccessToken, 'mock-enrolment', '654321');
    expect(adoptSession).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert')).toHaveLength(1);
    await input(t('acct.mfa.code'), '123456');
    const verifying = deferred<any>();
    jest.mocked(calls.verifyFactor).mockReturnValueOnce(verifying.promise);
    await press(t('acct.mfa.confirm'));
    disabled(t('acct.mfa.confirm'), t('acct.mfa.cancelSetup'));
    expect(control(t('acct.mfa.openApp')).props.accessibilityState.disabled).toBe(false);
    await act(async () => verifying.resolve(fixture.tokens));
    expect(calls.verifyFactor).toHaveBeenLastCalledWith(getAccessToken, 'mock-enrolment', '123456');
    expect(adoptSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: fixture.tokens.access_token, refreshToken: fixture.tokens.refresh_token }), 0);
    expect(texts(t('acct.mfa.on'))).toHaveLength(1);
});

test('TOTP cancel setup clears entry without deleting a factor; failed load can retry', async () => {
    jest.mocked(calls.fetchProfile).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(profile([]));
    await render(<MfaCard />);
    await press(t('acct.mfa.retry'));
    await press(t('acct.mfa.setup'));
    await input(t('acct.mfa.code'), '123456');
    await press(t('acct.mfa.cancelSetup'));
    expect(calls.unenrollFactor).not.toHaveBeenCalled();
    await press(t('acct.mfa.setup'));
    expect(field(t('acct.mfa.code')).props.value).toBe('');
});

test('locked TOTP unlock and removal preserve validation, busy state, confirmation and cancel', async () => {
    await render(<MfaCard />);
    disabled(t('acct.mfa.unlock'));
    await input(t('acct.mfa.code'), '123456');
    const pending = deferred<any>();
    jest.mocked(calls.verifyFactor).mockReturnValueOnce(pending.promise);
    await press(t('acct.mfa.unlock'));
    disabled(t('acct.mfa.unlock'));
    await act(async () => pending.resolve(fixture.tokens));
    expect(calls.verifyFactor).toHaveBeenCalledWith(getAccessToken, 'mock-totp', '123456');
    await press(t('acct.mfa.remove'));
    await confirm(true);
    expect(calls.unenrollFactor).not.toHaveBeenCalled();
    await press(t('acct.mfa.remove'));
    const removing = deferred();
    jest.mocked(calls.unenrollFactor).mockReturnValueOnce(removing.promise);
    await confirm();
    disabled(t('acct.mfa.remove'));
    expect(calls.unenrollFactor).toHaveBeenCalledWith(getAccessToken, 'mock-totp');
    await act(async () => removing.resolve());
});

test('MFA gate preserves wrong-code recovery, session adoption, busy validation and escape', async () => {
    await render(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>);
    disabled(t('acct.mfa.verify'));
    expect(texts('Inside')).toHaveLength(0);
    await input(t('acct.mfa.code'), '654321');
    jest.mocked(calls.verifyFactor).mockRejectedValueOnce(new AuthError(400, 'mfa_verification_failed'));
    await press(t('acct.mfa.verify'));
    expect(adoptSession).not.toHaveBeenCalled();
    await input(t('acct.mfa.code'), '123456');
    const pending = deferred<any>();
    jest.mocked(calls.verifyFactor).mockReturnValueOnce(pending.promise);
    await press(t('acct.mfa.verify'));
    disabled(t('acct.mfa.verify'));
    expect(control(t('public.account.signOut')).props.accessibilityState.disabled).toBe(false);
    await press(t('public.account.signOut'));
    expect(signOut).not.toHaveBeenCalled();
    await confirm(true);
    expect(signOut).not.toHaveBeenCalled();
    await press(t('public.account.signOut'));
    await confirm();
    expect(signOut).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(fixture.tokens));
    expect(calls.verifyFactor).toHaveBeenLastCalledWith(getAccessToken, 'mock-totp', '123456');
    expect(adoptSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: fixture.tokens.access_token }), 0);
    expect(markMfaCleared).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
    expect(rememberMfaEnrolment).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', true);
    expect(texts('Inside')).toHaveLength(1);
});

// Audit 2026-10-27 H2: a failed or slow check must not open the app for an account that may have two-factor.
test('MFA gate fails closed when the check fails, then retries into the app', async () => {
    jest.mocked(calls.fetchProfile).mockRejectedValueOnce(new AuthError(429, 'too_many_requests'));
    await render(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>);
    expect(texts('Inside')).toHaveLength(0);
    expect(texts(t('acct.mfa.unavailable'))).toHaveLength(1);
    expect(control(t('public.account.signOut')).props.accessibilityState.disabled).toBe(false);
    jest.mocked(calls.fetchProfile).mockResolvedValueOnce(profile([]));
    await press(t('acct.mfa.retry'));
    expect(texts('Inside')).toHaveLength(1);
    expect(rememberMfaEnrolment).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000001', false);
});

test('MFA gate opens on a failed check only for an account this phone saw without two-factor', async () => {
    jest.mocked(knownMfaEnrolment).mockResolvedValueOnce(false);
    jest.mocked(calls.fetchProfile).mockRejectedValueOnce(new Error('offline'));
    await render(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>);
    expect(texts('Inside')).toHaveLength(1);
    await act(async () => root.unmount());
    root = createRoot();
    jest.mocked(knownMfaEnrolment).mockResolvedValueOnce(true);
    jest.mocked(calls.fetchProfile).mockRejectedValueOnce(new Error('offline'));
    await render(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>);
    expect(texts('Inside')).toHaveLength(0);
    expect(texts(t('acct.mfa.unavailable'))).toHaveLength(1);
});

test('MFA gate timeout no longer opens the app, and a late answer still decides', async () => {
    jest.useFakeTimers();
    try {
        const slow = deferred<any>();
        jest.mocked(calls.fetchProfile).mockReturnValueOnce(slow.promise);
        await render(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>);
        await act(async () => { jest.advanceTimersByTime(GATE_TIMEOUT_MS + 1); });
        expect(texts('Inside')).toHaveLength(0);
        expect(texts(t('acct.mfa.unavailable'))).toHaveLength(1);
        await act(async () => slow.resolve(profile()));
        expect(controls(t('acct.mfa.verify'))).toHaveLength(1);
        expect(texts('Inside')).toHaveLength(0);
    } finally {
        jest.useRealTimers();
    }
});

test('password change preserves empty/invalid validation, trimmed nonce, API arguments and all busy conditions', async () => {
    await render(<PasswordCard />);
    disabled(t('acct.pw.update'));
    const sending = deferred();
    jest.mocked(calls.requestPasswordCode).mockReturnValueOnce(sending.promise);
    await press(t('acct.pw.send'));
    disabled(t('acct.pw.send'), t('acct.pw.update'));
    expect(calls.requestPasswordCode).toHaveBeenCalledWith(getAccessToken);
    await act(async () => sending.resolve());
    await input(t('acct.pw.new'), 'short');
    await input(t('acct.pw.code'), '123456');
    await press(t('acct.pw.update'));
    expect(texts(t('acct.pw.tooShort'))).toHaveLength(1);
    await input(t('acct.pw.new'), 'long-password');
    await input(t('acct.pw.code'), 'bad');
    await press(t('acct.pw.update'));
    expect(texts(t('acct.pw.badCode'))).toHaveLength(1);
    expect(calls.changePassword).not.toHaveBeenCalled();
    await input(t('acct.pw.code'), ' 123456 ');
    const changing = deferred();
    jest.mocked(calls.changePassword).mockReturnValueOnce(changing.promise);
    await press(t('acct.pw.update'));
    disabled(t('acct.pw.send'), t('acct.pw.update'));
    expect(calls.changePassword).toHaveBeenCalledWith(getAccessToken, 'long-password', '123456');
    await act(async () => changing.resolve());
    expect(field(t('acct.pw.new')).props.value).toBe('');
    expect(field(t('acct.pw.code')).props.value).toBe('');
});

test('passkey add and remove retain list, name, cancel, confirmation and busy gates', async () => {
    await render(<PasskeysCard />);
    const remove = t('pk.removeNamed', { name: 'iPhone' });
    const other = t('pk.removeNamed', { name: 'Laptop' });
    await press(remove);
    await confirm(true);
    expect(keys.removePasskey).not.toHaveBeenCalled();
    expect(control(remove)).toBeDefined();
    const removing = deferred();
    jest.mocked(keys.removePasskey).mockReturnValueOnce(removing.promise);
    await press(remove); await confirm();
    disabled(remove, other, t('passkey.add'));
    expect(field(t('passkey.nameLabel')).props.editable).toBe(false);
    expect(keys.removePasskey).toHaveBeenCalledWith(getAccessToken, 'mock_key_phone');
    await act(async () => removing.resolve());
    expect(controls(remove)).toHaveLength(0);
    await input(t('passkey.nameLabel'), 'New phone');
    const adding = deferred<any>();
    jest.mocked(keys.addPasskey).mockReturnValueOnce(adding.promise);
    await press(t('passkey.add'));
    disabled(other, t('passkey.add'));
    expect(keys.addPasskey).toHaveBeenCalledWith(getAccessToken, 'New phone');
    expect(field(t('passkey.nameLabel')).props.editable).toBe(false);
    await act(async () => adding.resolve({ id: 'new-passkey' }));
    expect(field(t('passkey.nameLabel')).props.value).toBe('');
});

test.each(['others', 'global'] as const)('device revocation %s requires confirmation and preserves scope', async scope => {
    await render(<DevicesCard />);
    const label = t(scope === 'global' ? 'acct.dev.everywhere' : 'acct.dev.others');
    await press(label); await confirm(true);
    expect(calls.revokeSessions).not.toHaveBeenCalled();
    const pending = deferred();
    jest.mocked(calls.revokeSessions).mockReturnValueOnce(pending.promise);
    await press(label); await confirm();
    disabled(t('acct.dev.everywhere'), t('acct.dev.others'));
    expect(calls.revokeSessions).toHaveBeenCalledWith(getAccessToken, scope);
    await act(async () => pending.resolve());
    expect(signOut).toHaveBeenCalledTimes(scope === 'global' ? 1 : 0);
});

test('grant revocation retains cancel, confirmation, client ID, refresh and busy gates', async () => {
    await render(<GrantsCard />);
    const label = t('acct.oauth.revokeNamed', { name: 'Demo assistant' });
    await press(label); await confirm(true);
    expect(calls.revokeGrant).not.toHaveBeenCalled();
    expect(control(label)).toBeDefined();
    const pending = deferred();
    jest.mocked(calls.revokeGrant).mockReturnValueOnce(pending.promise);
    await press(label); await confirm();
    disabled(label, t('acct.oauth.refresh'));
    expect(calls.revokeGrant).toHaveBeenCalledWith(getAccessToken, fixture.grants[0].client_id);
    await act(async () => pending.resolve());
    expect(controls(label)).toHaveLength(0);
    await press(t('acct.oauth.refresh'));
    expect(calls.fetchGrantsRaw).toHaveBeenCalledTimes(2);
});


test('retained pre-install unenrolled flag cannot open MFA gate when remote enabled profile times out', async () => {
    jest.useFakeTimers();
    const store = require('expo-secure-store');
    const install = require('../src/lib/installReset');
    jest.spyOn(install, 'getInstallId').mockReturnValue('new-install-11111111');
    jest.spyOn(store, 'getItemAsync').mockImplementation(async (key: unknown) =>
        key === 'veyrnox_mfa_enrolled_00000000-0000-4000-8000-000000000001' ? '0' : null);
    const actual = jest.requireActual<typeof import('../src/lib/mfaCheck')>('../src/lib/mfaCheck');
    jest.mocked(knownMfaEnrolment).mockImplementationOnce(actual.knownMfaEnrolment);
    const pending = deferred<Awaited<ReturnType<typeof calls.fetchProfile>>>();
    jest.mocked(calls.fetchProfile).mockReturnValueOnce(pending.promise);
    try {
        await render(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>);
        await act(async () => { jest.advanceTimersByTime(GATE_TIMEOUT_MS + 1); });
        expect(texts('Inside')).toHaveLength(0);
        expect(texts(t('acct.mfa.unavailable'))).toHaveLength(1);
        await act(async () => pending.resolve(profile()));
        expect(texts('Inside')).toHaveLength(0);
        expect(texts(t('acct.mfa.challengeTitle'))).toHaveLength(1);
    } finally { jest.useRealTimers(); }
});
