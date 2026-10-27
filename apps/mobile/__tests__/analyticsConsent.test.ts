import * as SecureStore from 'expo-secure-store';
import { CONSENT_KEY, parseConsent } from '../src/lib/analytics/consent';
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
afterEach(() => { delete process.env.EXPO_PUBLIC_POSTHOG_KEY; });
test.each([null, '', '{}', '{bad', '[]', '{"v":1,"choice":"granted"}', '{"v":2,"choice":"granted","at":1}', '{"v":1,"choice":"granted","at":"1"}'])('malformed storage is undecided: %s', raw => { expect(parseConsent(raw)).toBeNull(); });
test.each(['granted', 'denied'] as const)('round trip %s', async choice => {
    const { writeConsent, getAnalyticsChoice } = require('../src/lib/analytics/consent');
    await writeConsent(choice);
    expect(getAnalyticsChoice()).toBe(choice);
    const [key, raw] = jest.mocked(SecureStore.setItemAsync).mock.calls.at(-1)!;
    expect(key).toBe(CONSENT_KEY);
    expect(parseConsent(raw)).toBe(choice);
});
test('unreadable storage never becomes granted', async () => {
    jest.resetModules();
    const secure = require('expo-secure-store');
    secure.getItemAsync.mockRejectedValue(new Error('locked'));
    const consent = require('../src/lib/analytics/consent');
    expect(await consent.readConsent()).toBeNull();
});
test.each([undefined, '', 'invalid', 'phc_test'])('kill switch %s', key => {
    if (key === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY; else process.env.EXPO_PUBLIC_POSTHOG_KEY = key;
    expect(require('../src/lib/analytics/consent').isAnalyticsEnabled()).toBe(key === 'phc_test');
});

test('a delayed grant cannot overtake a later decline', async () => {
    jest.resetModules();
    const secure = require('expo-secure-store');
    let finish!: () => void;
    secure.setItemAsync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const consent = require('../src/lib/analytics/consent');
    const grant = consent.writeConsent('granted');
    await Promise.resolve(); await Promise.resolve();
    const deny = consent.writeConsent('denied');
    expect(consent.getAnalyticsChoice()).toBe('denied');
    finish(); await grant;
    expect(consent.getAnalyticsChoice()).toBe('denied');
    await deny;
    expect(JSON.parse(secure.setItemAsync.mock.calls.at(-1)[1]).choice).toBe('denied');
});

test('an unsaved initial decline is enforced now and undecided on the next launch', async () => {
    jest.resetModules();
    const secure = require('expo-secure-store');
    secure.getItemAsync.mockResolvedValue(null);
    secure.setItemAsync.mockRejectedValueOnce(new Error('locked'));
    const consent = require('../src/lib/analytics/consent');
    await expect(consent.writeConsent('denied')).resolves.toBeUndefined();
    expect(consent.getAnalyticsChoice()).toBe('denied');
    jest.resetModules();
    require('expo-secure-store').getItemAsync.mockResolvedValue(null);
    expect(await require('../src/lib/analytics/consent').readConsent()).toBeNull();
});

test('a decline that cannot be saved removes an earlier saved grant', async () => {
    jest.resetModules();
    const secure = require('expo-secure-store');
    secure.getItemAsync.mockResolvedValue(JSON.stringify({ v: 1, choice: 'granted', at: 1 }));
    secure.setItemAsync.mockRejectedValueOnce(new Error('locked'));
    secure.deleteItemAsync.mockResolvedValue(undefined);
    const consent = require('../src/lib/analytics/consent');
    expect(await consent.readConsent()).toBe('granted');
    await expect(consent.writeConsent('denied')).resolves.toBeUndefined();
    expect(consent.getAnalyticsChoice()).toBe('denied');
    expect(secure.deleteItemAsync).toHaveBeenCalledWith(CONSENT_KEY);
});

test('a decline still continues when neither saving nor removing works', async () => {
    jest.resetModules();
    const secure = require('expo-secure-store');
    secure.setItemAsync.mockRejectedValueOnce(new Error('locked'));
    secure.deleteItemAsync.mockRejectedValueOnce(new Error('locked'));
    const consent = require('../src/lib/analytics/consent');
    await expect(consent.writeConsent('denied')).resolves.toBeUndefined();
    expect(consent.getAnalyticsChoice()).toBe('denied');
});

test('cached reads reflect the latest choice when another account checks the gate', async () => {
    jest.resetModules();
    const secure = require('expo-secure-store');
    secure.getItemAsync.mockResolvedValue(null);
    const consent = require('../src/lib/analytics/consent');
    expect(await consent.readConsent()).toBeNull();
    await consent.writeConsent('denied');
    expect(await consent.readConsent()).toBe('denied');
    expect(secure.getItemAsync).toHaveBeenCalledTimes(1);
});
