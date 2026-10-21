import { AuthError } from '../src/lib/auth/supabaseAuth';
import { fetchPasskeys, parsePasskeys, passkeyErrorKey, removePasskey, validPasskeyId } from '../src/lib/passkeys';

const ID = 'pk_12345678';
const res = (status: number, body: unknown) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('passkeys', () => {
    const fetchMock = jest.fn();
    const token = async () => 'tok';
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    test('reads a list or { passkeys }, drops rows that cannot be removed, and survives junk', () => {
        const row = { id: ID, friendly_name: 'iCloud Keychain', created_at: '2026-01-01T00:00:00Z', last_used_at: null };
        expect(parsePasskeys([row])).toEqual([{ id: ID, name: 'iCloud Keychain', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }]);
        expect(parsePasskeys({ passkeys: [row, { id: '../x' }, { friendly_name: 'no id' }, null, 5] })).toHaveLength(1);
        expect(parsePasskeys(null)).toEqual([]);
        expect(parsePasskeys({ passkeys: 'x' })).toEqual([]);
    });
    test('ids are checked before any request', () => {
        expect(validPasskeyId(ID)).toBe(true);
        expect(validPasskeyId('../x')).toBe(false);
        expect(validPasskeyId('short')).toBe(false);
        expect(validPasskeyId(5)).toBe(false);
    });
    test('lists with a GET and removes with a DELETE on the encoded id', async () => {
        fetchMock.mockResolvedValueOnce(res(200, [{ id: ID }]));
        expect(await fetchPasskeys(token)).toHaveLength(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/v1/passkeys');
        fetchMock.mockResolvedValueOnce(res(200, {}));
        await removePasskey(token, ID);
        expect(String(fetchMock.mock.calls[1][0])).toContain(`/auth/v1/passkeys/${ID}`);
        expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
    });
    test('a bad id sends nothing', async () => {
        await expect(removePasskey(token, '../x')).rejects.toMatchObject({ status: 400 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    test('wording', () => {
        expect(passkeyErrorKey(new AuthError(0, 'network'))).toBe('pk.err.network');
        expect(passkeyErrorKey(new AuthError(404, 'x'))).toBe('pk.err.off');
        expect(passkeyErrorKey(new AuthError(403, 'insufficient_aal'))).toBe('pk.err.aal');
        expect(passkeyErrorKey(new Error('x'))).toBe('pk.err.failed');
    });
});

// Keep all native calls mocked, including availability on machines without a development client.
jest.mock('react-native-passkeys', () => ({ isSupported: jest.fn(() => true), create: jest.fn(), get: jest.fn() }));
import { Platform } from 'react-native';
import * as native from 'react-native-passkeys';
import { addPasskey, passkeyGate, toGoTrueCredential, validatePasskeyOptions, passkeySignInErrorKey, passkeyAddErrorKey, passkeysServerAvailable } from '../src/lib/passkeys';
import { classifyNativeError, createCredential, getCredential, nativePasskeysSupported, PasskeyCeremonyError } from '../src/lib/auth/passkeyNative';

const registration = { id: 'id', rawId: 'raw', type: 'public-key', clientExtensionResults: { credProps: { rk: true } }, authenticatorAttachment: 'platform', response: { clientDataJSON: 'client', attestationObject: 'attestation' } };
const assertion = { ...registration, response: { clientDataJSON: 'client', authenticatorData: 'auth', signature: 'sig', userHandle: 'user' } };
const creation = { challenge_id: 'challenge-id', options: { challenge: 'challenge', rp: { id: 'veyrnox.ai' }, user: { id: 'user' } } };
const originalOS = Platform.OS;
const originalIosFlag = process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
const originalAndroidFlag = process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED;

afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    if (originalIosFlag === undefined) delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
    else process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = originalIosFlag;
    if (originalAndroidFlag === undefined) delete process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED;
    else process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED = originalAndroidFlag;
});

describe('native passkey contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(native.isSupported).mockReturnValue(true);
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
        process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = 'true';
        delete process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED;
    });

    test.each([registration, assertion])('normalises only the web credential fields', (credential) => {
        expect(toGoTrueCredential({ ...credential, extra: 'drop', transports: ['internal'], response: { ...credential.response, transports: ['internal'], publicKey: 'drop', publicKeyAlgorithm: -7, unexpected: 'drop' } })).toEqual(credential);
    });
    test.each(['id', 'rawId', 'clientDataJSON'])('rejects missing %s', (key) => {
        const value = { ...assertion, response: { ...assertion.response } } as Record<string, any>;
        if (key === 'clientDataJSON') delete value.response[key]; else delete value[key];
        expect(() => toGoTrueCredential(value)).toThrow(new AuthError(502, 'malformed_credential'));
    });
    test('drops non-string optional binary fields', () => {
        expect(toGoTrueCredential({ ...registration, authenticatorAttachment: 1, response: { clientDataJSON: 'client', signature: 23 } })).toEqual({ ...registration, authenticatorAttachment: undefined, response: { clientDataJSON: 'client' } });
    });
    test.each([undefined, '', 'false', 'TRUE', '1'])('gate defaults off for %s', (flag) => {
        if (flag === undefined) delete process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED;
        else process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = flag;
        expect(passkeyGate()).toBe(false);
        expect(native.isSupported).not.toHaveBeenCalled();
    });
    test('platform flags are independent; support alone never enables Android or web', () => {
        expect(passkeyGate()).toBe(true);
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
        expect(passkeyGate()).toBe(false);
        process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED = 'true';
        expect(passkeyGate()).toBe(true);
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
        expect(passkeyGate()).toBe(false);
    });
    test('support failures degrade quietly', () => {
        jest.mocked(native.isSupported).mockImplementationOnce(() => { throw new Error('missing native module'); });
        expect(nativePasskeysSupported()).toBe(false);
        jest.mocked(native.isSupported).mockReturnValue(false);
        expect(passkeyGate()).toBe(false);
    });
    test.each([
        ['UserCancelledException', 'cancelled'], ['ERR_USER_CANCELLED', 'cancelled'], ['UserCancelled', 'cancelled'], ['user canceled', 'cancelled'],
        ['NoCredentials', 'no_credential'], ['NotConfigured', 'setup'], ['ERR_NOT_CONFIGURED', 'setup'],
        ['NotSupported', 'unsupported'], ['NotSupportedError', 'unsupported'], ['ERR_NOT_SUPPORTED', 'unsupported'], ['ERR_BIOMETRIC', 'unsupported'],
        ['ERR_PENDING_PASSKEY_REQUEST', 'busy'], ['Interrupted', 'busy'], ['UnknownError', 'failed'], ['DomError: detail', 'failed'],
    ])('classifies native %s without exposing it', (value, expected) => {
        expect(classifyNativeError({ message: value })).toBe(expected);
        expect(classifyNativeError({ code: value })).toBe(expected);
    });
    test('wrapper returns JSON/null and replaces raw errors', async () => {
        const options = validatePasskeyOptions(creation, true).options;
        jest.mocked(native.create).mockResolvedValueOnce(registration as never).mockRejectedValueOnce({ code: 'ERR_USER_CANCELLED' }).mockRejectedValueOnce(new Error('secret UnknownError'));
        expect(await createCredential(options)).toBe(registration);
        expect(await createCredential(options)).toBeNull();
        await expect(createCredential(options)).rejects.toMatchObject({ kind: 'failed', message: 'passkey_ceremony' });
        jest.mocked(native.get).mockResolvedValueOnce(assertion as never).mockResolvedValueOnce(null).mockRejectedValueOnce({ message: 'UserCancelled' }).mockRejectedValueOnce({ message: 'NoCredentials' });
        expect(await getCredential({ challenge: 'c' })).toBe(assertion);
        expect(await getCredential({ challenge: 'c' })).toBeNull();
        expect(await getCredential({ challenge: 'c' })).toBeNull();
        await expect(getCredential({ challenge: 'c' })).rejects.toMatchObject({ kind: 'no_credential' });
    });
});

describe('enrolment requests', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        fetchMock.mockReset();
        globalThis.fetch = fetchMock;
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
        process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = 'true';
        jest.mocked(native.isSupported).mockReturnValue(true);
        jest.mocked(native.create).mockResolvedValue(registration as never);
    });
    test.each([['   ', {}], ['  My phone  ', { friendly_name: 'My phone' }], ['x'.repeat(80), { friendly_name: 'x'.repeat(64) }]])('sends trimmed name %s then exact verify body', async (name, expected) => {
        fetchMock.mockResolvedValueOnce(res(200, creation)).mockResolvedValueOnce(res(200, { id: ID }));
        await expect(addPasskey(async () => 'token', name)).resolves.toEqual({ id: ID });
        expect(fetchMock.mock.calls[0][0]).toContain('/registration/options');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expected);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
        expect(fetchMock.mock.calls[1][0]).toContain('/registration/verify');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ challenge_id: 'challenge-id', credential: registration });
    });
    test('cancel sends no verify', async () => {
        fetchMock.mockResolvedValueOnce(res(200, creation));
        jest.mocked(native.create).mockResolvedValueOnce(null);
        expect(await addPasskey(async () => 'token', '')).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    test('closed gate sends no request or ceremony', async () => {
        process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = 'false';
        expect(await addPasskey(async () => 'token', '')).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(native.create).not.toHaveBeenCalled();
    });
    test.each([null, {}, { ...creation, challenge_id: '' }, { ...creation, challenge_id: ' ' }, { ...creation, options: [] }, { ...creation, options: { challenge: 1 } }, { ...creation, options: { challenge: 'c', rp: { id: 'rp' } } }, { ...creation, options: { challenge: 'c', user: { id: 'u' } } }])('malformed options never open a prompt: %j', async (body) => {
        fetchMock.mockResolvedValueOnce(res(200, body));
        await expect(addPasskey(async () => 'token', '')).rejects.toMatchObject({ status: 502, code: 'malformed_options' });
        expect(native.create).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    test('settings uses apikey only and permits a failed read', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ passkeys_enabled: false }), { status: 200 }));
        expect(await passkeysServerAvailable()).toBe(false);
        expect(Object.keys(fetchMock.mock.calls[0][1].headers)).toEqual(['apikey']);
        fetchMock.mockRejectedValueOnce(new Error('offline'));
        expect(await passkeysServerAvailable()).toBe(true);
        fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
        expect(await passkeysServerAvailable()).toBe(true);
    });
});

test.each([
    [new Error('UserCancelled'), null], [new AuthError(0, 'network'), 'network'], [new AuthError(400, 'captcha_failed'), 'captcha'],
    [new AuthError(403, 'passkey_disabled'), 'off'], [new AuthError(404, 'anything'), 'off'],
    [new AuthError(400, 'webauthn_credential_not_found'), 'noCredential'], [new PasskeyCeremonyError('no_credential'), 'noCredential'],
    [new AuthError(400, 'webauthn_challenge_expired'), 'expired'], [new PasskeyCeremonyError('unsupported'), 'unsupported'],
    [new PasskeyCeremonyError('setup'), 'setup'], [new PasskeyCeremonyError('busy'), 'busy'],
    [new AuthError(403, 'origin_rejected'), 'refused'], [new AuthError(429, 'rate_limited'), 'busy'],
    [new AuthError(502, 'bad_response'), 'failed'], [new PasskeyCeremonyError('failed'), 'failed'], [new Error('private detail'), 'failed'],
])('sign-in error mapping %j', (error, suffix) => {
    expect(passkeySignInErrorKey(error)).toBe(suffix === null ? null : `passkey.err.${suffix}`);
});

test('enrolment keeps existing errors, adds duplicates and safe ceremony errors', () => {
    expect(passkeyAddErrorKey(new AuthError(400, 'webauthn_credential_exists'))).toBe('passkey.duplicate');
    expect(passkeyAddErrorKey(new AuthError(403, 'passkey_disabled'))).toBe('pk.err.off');
    expect(passkeyAddErrorKey(new AuthError(403, 'insufficient_aal'))).toBe('pk.err.aal');
    expect(passkeyAddErrorKey(new PasskeyCeremonyError('setup'))).toBe('passkey.err.setup');
});
