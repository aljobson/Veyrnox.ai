import { redirectSystemPath } from '../src/app/+native-intent';
import { AUTH_REDIRECT_URL } from '../src/lib/config';
import { RETURN_URL } from '../src/lib/publishConnect';
import { isSchemeCallback } from '../src/lib/schemeCallbacks';
import { recallPendingLink, forgetPendingLink } from '../src/lib/pendingLink';

const mockSlots = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItem: (key: string) => mockSlots.get(key) ?? null,
    setItem: (key: string, value: string) => { mockSlots.set(key, value); },
    deleteItemAsync: async (key: string) => { mockSlots.delete(key); },
}));
jest.mock('../src/lib/media', () => ({ fetchCatalog: jest.fn(async () => [{ id: 'video', gated: false }]) }));
jest.mock('../src/lib/presets', () => ({ fetchPresets: jest.fn(async () => []), presetHref: jest.fn() }));

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'abc_DEF-123.sig_456'; // gitleaks:allow -- synthetic team-invite token fixture
beforeEach(() => { mockSlots.clear(); });

describe('the sign-in and Publish connect callbacks (Android delivers them as ordinary links)', () => {
    test('the constants are the two addresses the app registers', () => {
        expect(AUTH_REDIRECT_URL).toBe('ai.veyrnox.app://auth/callback');
        expect(RETURN_URL).toBe('ai.veyrnox.app://social/callback');
    });
    test('recognises exactly those two, with or without a query or fragment', () => {
        expect(isSchemeCallback(AUTH_REDIRECT_URL)).toBe(true);
        expect(isSchemeCallback(`${AUTH_REDIRECT_URL}?code=abc123`)).toBe(true);
        expect(isSchemeCallback(`${AUTH_REDIRECT_URL}?error=access_denied#x`)).toBe(true);
        expect(isSchemeCallback(`${RETURN_URL}?code=abc&state=def`)).toBe(true);
        expect(isSchemeCallback(`${RETURN_URL}#frag`)).toBe(true);
    });
    test('nothing else counts', () => {
        for (const link of [
            'ai.veyrnox.app://auth/callback/extra', 'ai.veyrnox.app://auth/callbacks', 'ai.veyrnox.app://auth', 'ai.veyrnox.app://social/callback2',
            'ai.veyrnox.app://library', 'other.app://auth/callback', 'https://veyrnox.ai/auth/callback', '/auth/callback', 'auth/callback', '',
        ]) expect(isSchemeCallback(link)).toBe(false);
    });
    test('while the app is open nothing is navigated, so the person stays where they are', () => {
        expect(redirectSystemPath({ path: `${AUTH_REDIRECT_URL}?code=abc123`, initial: false })).toBeNull();
        expect(redirectSystemPath({ path: `${RETURN_URL}?code=abc&state=def`, initial: false })).toBeNull();
    });
    test('on a cold start the app opens at the root', () => {
        expect(redirectSystemPath({ path: `${AUTH_REDIRECT_URL}?code=abc123`, initial: true })).toBe('/');
        expect(redirectSystemPath({ path: RETURN_URL, initial: true })).toBe('/');
    });
    test('a callback is never kept as a destination', () => {
        redirectSystemPath({ path: `${AUTH_REDIRECT_URL}?code=abc123`, initial: false });
        expect(recallPendingLink()).toBeNull();
    });
});

describe('ordinary links still resolve, and their destination is kept for after sign-in', () => {
    test('a web link maps to its screen and is remembered', () => {
        expect(redirectSystemPath({ path: `https://veyrnox.ai/social/team/invite/${TOKEN}`, initial: true })).toBe(`/team-invite?token=${TOKEN}`);
        expect(recallPendingLink()).toBe(`/team-invite?token=${TOKEN}`);
        expect(redirectSystemPath({ path: `https://veyrnox.ai/social-cinema/title/${ID}`, initial: false })).toBe(`/cinema/${ID}`);
        expect(recallPendingLink()).toBe(`/cinema/${ID}`);
    });
    test('Home, the public review screen, the app scheme and other hosts are not remembered', () => {
        expect(redirectSystemPath({ path: 'https://veyrnox.ai/pricing', initial: false })).toBe('/');
        expect(redirectSystemPath({ path: `https://veyrnox.ai/social/review/${TOKEN}`, initial: false })).toBe(`/review?token=${TOKEN}`);
        expect(redirectSystemPath({ path: 'ai.veyrnox.app://library', initial: false })).toBe('ai.veyrnox.app://library');
        expect(redirectSystemPath({ path: 'https://evil.test/app/library', initial: false })).toBe('https://evil.test/app/library');
        expect(recallPendingLink()).toBeNull();
    });
    test('a link resolved by lookup is remembered once it resolves', async () => {
        const result = redirectSystemPath({ path: 'https://veyrnox.ai/app/create?model=video', initial: false });
        expect(typeof result).not.toBe('string');
        expect(await result).toBe('/create/video');
        expect(recallPendingLink()).toBe('/create/video');
        forgetPendingLink();
    });
});
