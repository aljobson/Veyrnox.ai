import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';
import * as Sentry from '@sentry/react-native';

const mockSecure = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockWrite = jest.fn((path: string, value: string) => { mockFiles.set(path, value); });
const mockRead = jest.fn((path: string) => mockFiles.get(path)!);
jest.mock('expo-secure-store', () => ({
    getItem: jest.fn((key: string) => mockSecure.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { mockSecure.set(key, value); }),
    getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { mockSecure.delete(key); }),
}));
jest.mock('expo-file-system', () => {
    class Directory { uri: string; constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); } }
    class File extends Directory {
        get exists() { return mockFiles.has(this.uri); }
        create() { mockFiles.set(this.uri, ''); }
        writeSync(value: string) { mockWrite(this.uri, value); }
        async write(value: string) { mockWrite(this.uri, value); }
        textSync() { return mockRead(this.uri); }
        async text() { return mockRead(this.uri); }
        delete() { mockFiles.delete(this.uri); }
    }
    return { File, Directory, Paths: { document: 'docs', cache: 'cache' } };
});
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('@sentry/react-native', () => ({ init: jest.fn(), captureMessage: jest.fn(), wrap: (x: unknown) => x }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
jest.mock('../src/lib/i18n/device', () => ({
    ...jest.requireActual('../src/lib/i18n/device'), readDeviceSources: () => ({}), deviceLanguageTags: () => ['en'],
}));
jest.mock('expo-router/entry', () => {
    // The real module readers run in the same isolated registry, only after the reset statement.
    const theme = require('../src/theme');
    const i18n = require('../src/lib/i18n');
    expect(theme.getAppearance()).toEqual(theme.DEFAULT_APPEARANCE);
    expect(i18n.getLocale()).toBe('en');
    expect(require('../src/lib/languageStore').readLanguage()).toBeNull();
});
const markerPath = 'docs/veyrnox.install.v1';
const welcomePath = 'cache/veyrnox-cache/veyrnox.welcome.seen.v2.json';
const marker = (state: string) => JSON.stringify({ v: 1, state, installId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
let reset: typeof import('../src/lib/installReset');
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function launch() { jest.isolateModules(() => { reset = require('../src/lib/installReset'); reset.resetInstall(); }); }
beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSecure.clear(); mockFiles.clear();
    mockWrite.mockImplementation((path, value) => { mockFiles.set(path, value); });
    mockRead.mockImplementation(path => mockFiles.get(path)!);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('custom entry blanks every fixed key before cached appearance/language load; cleanup completes', async () => {
    const finishDeletes: (() => void)[] = [];
    jest.isolateModules(() => {
        reset = require('../src/lib/installReset');
        for (const key of reset.INSTALL_RESET_KEYS) {
            mockSecure.set(key, 'old');
            jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(deletedKey => new Promise(resolve => {
                finishDeletes.push(() => { mockSecure.delete(deletedKey); resolve(); });
            }));
        }
        mockSecure.set('veyrnox.theme', 'oled');
        mockSecure.set('veyrnox.accent', 'rose');
        const language = require('../src/lib/language');
        mockSecure.set(language.LANGUAGE_SLOT, language.serializeLanguage('fr'));
        expect(language.parseLanguage(mockSecure.get(language.LANGUAGE_SLOT))).toBe('fr');
        mockSecure.set('veyrnox_push_device', 'device');
        mockSecure.set('veyrnox.oddlings.legacy.v1', 'done:original-owner');
        require('../index');
    });
    for (const key of reset.INSTALL_RESET_KEYS) expect(mockSecure.get(key)).toBe('');
    expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('pending');
    finishDeletes.forEach(finish => finish());
    await tick();
    for (const key of reset.INSTALL_RESET_KEYS) expect(mockSecure.has(key)).toBe(false);
    expect(mockSecure.get('veyrnox_push_device')).toBe('device');
    expect(mockSecure.get('veyrnox.oddlings.legacy.v1')).toBe('done:original-owner');
    expect(JSON.parse(mockFiles.get(markerPath)!)).toMatchObject({ v: 1, state: 'complete' });
    expect(SecureStore.setItem).toHaveBeenCalledTimes(reset.INSTALL_RESET_KEYS.length);
});

test('a synchronous overwrite failure continues startup, reports once and leaves pending', async () => {
    mockSecure.set('veyrnox_refresh_token', 'private-token');
    jest.mocked(SecureStore.setItem).mockImplementationOnce(() => { throw Error('private-error'); });
    expect(launch).not.toThrow();
    await tick();
    const report = jest.fn();
    reset.flushInstallResetIssue(report);
    reset.flushInstallResetIssue(report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('install_reset_failed', { step: 'delete' });
    expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('pending');
    // The blanking failed, but the delete is still queued, so the old session does not survive.
    expect(mockSecure.has('veyrnox_refresh_token')).toBe(false);
});

test.each(['not-json', JSON.stringify({ v: 1, state: 'complete', installId: '../invalid' })])(
    'invalid marker %s requires a verified pending write before resetting', async raw => {
        mockFiles.set(markerPath, raw);
        mockSecure.set('veyrnox_refresh_token', 'old');
        launch(); await tick();
        expect(JSON.parse(mockWrite.mock.calls[0][1]).state).toBe('pending');
        expect(mockSecure.has('veyrnox_refresh_token')).toBe(false);
        expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('complete');
    },
);

test('update reset clears sandbox welcome even when the same account signs back in', async () => {
    let destination!: () => Promise<unknown>;
    await jest.isolateModulesAsync(async () => {
        const { serializeSeen, FIRST_RUN_SLOT } = require('../src/lib/firstRun');
        mockSecure.set(FIRST_RUN_SLOT, serializeSeen()); mockFiles.set(welcomePath, serializeSeen());
        mockFiles.set('cache/veyrnox-cache/veyrnox.cache.v1.__user.json', 'same-user');
        reset = require('../src/lib/installReset'); reset.resetInstall();
        const { bindCacheUser } = require('../src/lib/appCache');
        await bindCacheUser('same-user');
        const gate = require('../src/lib/firstRunPending');
        gate.setFirstRunUser('same-user'); destination = gate.firstRunDestination;
        expect(await destination()).toBe('/welcome');
        expect(await require('../src/lib/auth/sessionStore').readRefreshToken()).toBeFalsy();
    });
    expect(mockFiles.has(welcomePath)).toBe(false);
});

test('complete marker preserves token and all settings', async () => {
    mockFiles.set(markerPath, marker('complete')); mockSecure.set('veyrnox_refresh_token', 'token');
    launch(); await tick();
    expect(SecureStore.setItem).not.toHaveBeenCalled(); expect(mockWrite).not.toHaveBeenCalled();
    expect(mockSecure.get('veyrnox_refresh_token')).toBe('token');
    expect(reset.getInstallId()).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('interruption after pending resumes the wipe using the same id', async () => {
    mockFiles.set(markerPath, marker('pending')); mockSecure.set('veyrnox_refresh_token', 'token');
    launch(); await tick();
    expect(mockSecure.has('veyrnox_refresh_token')).toBe(false);
    expect(JSON.parse(mockFiles.get(markerPath)!)).toEqual(JSON.parse(marker('complete')));
});

test('failed read-back never wipes or completes and the next launch retries', async () => {
    mockSecure.set('veyrnox_refresh_token', 'token'); mockRead.mockImplementationOnce(() => { throw Error('private'); });
    launch(); await tick();
    expect(SecureStore.setItem).not.toHaveBeenCalled();
    expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('pending');
    launch(); await tick(); expect(mockSecure.has('veyrnox_refresh_token')).toBe(false);
});

test('two failed pending writes never sign out', async () => {
    mockSecure.set('veyrnox_refresh_token', 'token'); mockWrite.mockImplementation(() => { throw Error('private'); });
    launch(); await tick(); expect(reset.getInstallId()).toBeNull();
    launch(); await tick();
    expect(mockSecure.get('veyrnox_refresh_token')).toBe('token');
    expect(SecureStore.setItem).not.toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledTimes(2);
});

test('completion failure leaves pending and retries an idempotent wipe', async () => {
    mockWrite.mockImplementation((path, value) => { if (JSON.parse(value).state === 'complete') throw Error('private'); mockFiles.set(path, value); });
    launch(); await tick(); expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('pending');
    mockSecure.set('veyrnox_refresh_token', 'intervening-session');
    mockWrite.mockImplementation((path, value) => { mockFiles.set(path, value); });
    launch(); await tick(); expect(mockSecure.has('veyrnox_refresh_token')).toBe(false);
    expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('complete');
});

test.each(['marker_write', 'marker_read', 'delete'] as const)('sanitized %s failure reaches real Sentry init guard exactly once', async step => {
    const dev = __DEV__; const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
    (globalThis as any).__DEV__ = false; process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.com/1';
    try {
        await jest.isolateModulesAsync(async () => {
            reset = require('../src/lib/installReset');
            const crash = require('../src/lib/crash');
            if (step === 'marker_write') mockWrite.mockImplementation(() => { throw Error('secret-token'); });
            if (step === 'marker_read') mockRead.mockImplementation(() => { throw Error('secret-token'); });
            if (step === 'delete') jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(Error('secret-token'));
            reset.resetInstall(); await tick();
            crash.captureIssue('before-init', {});
            expect(Sentry.captureMessage).not.toHaveBeenCalled();
            expect(crash.initCrashReporting()).toBe(true);
            reset.flushInstallResetIssue(crash.captureIssue); reset.flushInstallResetIssue(crash.captureIssue);
            expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
            expect(Sentry.captureMessage).toHaveBeenCalledWith('install_reset_failed', { level: 'warning', tags: { step } });
        });
    } finally { (globalThis as any).__DEV__ = dev; if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN; else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn; }
});

test('late async deletion failure is reported after crash reporting started; readers already see empty', async () => {
    let reject!: (reason: Error) => void;
    jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    mockSecure.set('veyrnox_refresh_token', 'old'); launch();
    expect(await SecureStore.getItemAsync('veyrnox_refresh_token')).toBe('');
    const report = jest.fn(); reset.flushInstallResetIssue(report);
    reject(Error('secret')); await tick();
    expect(report).toHaveBeenCalledWith('install_reset_failed', { step: 'delete' });
    expect(JSON.parse(mockFiles.get(markerPath)!).state).toBe('pending');
});

test('MFA enrolment ignores legacy and previous-install zero, including an unwritable marker', async () => {
    mockSecure.set('veyrnox_mfa_enrolled_user', '0');
    mockSecure.set('veyrnox_mfa_enrolled_old-install_user', '0');
    await jest.isolateModulesAsync(async () => {
        reset = require('../src/lib/installReset'); reset.resetInstall();
        const mfa = require('../src/lib/mfaCheck');
        expect(await mfa.knownMfaEnrolment('user')).toBeNull();
        await mfa.rememberMfaEnrolment('user', false);
        expect(await mfa.knownMfaEnrolment('user')).toBe(false);
    });
    mockFiles.clear(); mockWrite.mockImplementation(() => { throw Error('unwritable'); });
    await jest.isolateModulesAsync(async () => {
        reset = require('../src/lib/installReset'); reset.resetInstall();
        const mfa = require('../src/lib/mfaCheck');
        expect(await mfa.knownMfaEnrolment('user')).toBeNull();
        await mfa.rememberMfaEnrolment('user', false);
        expect(await mfa.knownMfaEnrolment('user')).toBeNull();
    });
});
