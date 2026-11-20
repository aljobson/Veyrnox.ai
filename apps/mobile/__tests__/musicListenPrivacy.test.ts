import { scrubBreadcrumb, scrubEvent } from '../src/lib/scrub';
import { rememberPendingLink } from '../src/lib/pendingLink';
import { reconcileLanguageDirection, DIRECTION_SLOT, createDirectionReconciler, languageReturnPath } from '../src/lib/languageDirection';
import { setLocaleFromDevice } from '../src/lib/i18n';
import { saveThemeReturnPath, takeThemeReturnPath, applyAppearance, getAppearance, THEME_RETURN_KEY } from '../src/theme';
import { token } from './fixtures/musicPublication';
const mockStore = new Map<string, string>(), mockWrites = jest.fn();
jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockStore.get(key) ?? null, getItemAsync: async (key: string) => mockStore.get(key) ?? null,
    setItem: (key: string, value: string) => { mockWrites(key, value); mockStore.set(key, value); },
    setItemAsync: async (key: string, value: string) => { mockWrites(key, value); mockStore.set(key, value); },
    deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));
jest.mock('expo', () => ({ reloadAppAsync: jest.fn(async () => {}) }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
beforeEach(() => { mockStore.clear(); mockWrites.mockClear(); setLocaleFromDevice(['en']); });
const forms = [`/api/music/shared/${token}`, `/api/music/shared/${token}/asset`, `/listen/${token}`, `/music/listen/${token}`];
test.each(forms.flatMap(path => [path, `https://veyrnox.ai${path}`]))('breadcrumb and event redact every occurrence in %s', url => {
    const crumb = { category: 'navigation', message: url, data: { url, from: url, to: url, route: { params: { token, share_token: token }, pathname: url } } };
    const clean = scrubBreadcrumb(crumb);
    expect(JSON.stringify(clean)).not.toContain(token); expect(clean.data.url).toContain(':token');
    expect(clean.data.route.params).toEqual({ token: ':token', share_token: ':token' });
    const event = scrubEvent({ request: { url }, transaction: `GET ${url}`, breadcrumbs: [crumb], contexts: { trace: { route: { params: { token }, name: url } } } });
    expect(JSON.stringify(event)).not.toContain(token); expect(event.transaction).toContain(':token'); expect(event.request.url).toContain(':token');
    expect(crumb.data.url).toBe(url); // scrubbing must not mutate the navigation state
});
test.each([`/listen/${token}`, `/music/listen/${token}`, `/music/listen/${token}?x=1`, `/(app)/music/listen/${token}`])('real pending/theme writers never serialize %s', async path => {
    expect(rememberPendingLink(path)).toBe(false); expect(mockWrites).not.toHaveBeenCalled();
    expect(languageReturnPath(path, { token }, ['music', 'listen', '[token]'])).toBe('/');
    expect(await saveThemeReturnPath(path)).toBe(true); expect(mockStore.get(THEME_RETURN_KEY)).toBe('/');
    expect(await takeThemeReturnPath()).toBe('/');
    await applyAppearance({ textSize: getAppearance().textSize === 'l' ? 'm' : 'l' }, path);
    expect(mockStore.get(THEME_RETURN_KEY)).toBe('/'); expect(JSON.stringify(mockWrites.mock.calls)).not.toContain(token);
});
test('real reconcileLanguageDirection stores only root for an unavoidable direction reload', async () => {
    setLocaleFromDevice(['ar']); await reconcileLanguageDirection(`/music/listen/${token}`, { signedIn: false, canReloadSession: () => false });
    expect(JSON.parse(mockStore.get(DIRECTION_SLOT)!)).toEqual({ locale: 'ar', returnPath: '/' });
    expect(JSON.stringify(mockWrites.mock.calls)).not.toContain(token);
});
test.each([`/listen/${token}`, `/music/listen/${token}`])('real language transition and storage sanitize %s', async path => {
    // A fresh module has no prior automatic reload in flight.
    jest.resetModules();
    const { changeLanguage: change } = jest.requireActual('../src/lib/languageTransition') as typeof import('../src/lib/languageTransition');
    expect(await change('es', path, { signedIn: false, canReloadSession: () => false }, { current: 'en', nativeRtl: false })).toBe(true);
    expect(mockStore.get(THEME_RETURN_KEY)).toBe('/'); expect(JSON.stringify(mockWrites.mock.calls)).not.toContain(token);
});
test('old persisted secret return routes are sanitized when read', async () => {
    mockStore.set(THEME_RETURN_KEY, `/listen/${token}`); expect(await takeThemeReturnPath()).toBe('/');
    const r = createDirectionReconciler({ read: async () => JSON.stringify({ locale: 'en', returnPath: `/music/listen/${token}` }), write: jest.fn(), nativeRtl: () => false, direction: jest.fn(), reload: jest.fn() });
    await r.reconcile('en', '/', { signedIn: false, canReloadSession: () => false }); expect(r.takeReturnPath()).toBe('/');
});
