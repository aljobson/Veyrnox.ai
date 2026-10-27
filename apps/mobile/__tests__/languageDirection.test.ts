import { createDirectionReconciler, languageReturnPath, DIRECTION_SLOT, type DirectionDependencies } from '../src/lib/languageDirection';
import { needsLanguageChoice } from '../src/lib/languageTransition';
import { ACTIVE_LOCALES, startupLocale, type LocaleCode } from '../src/lib/i18n';
import { LANGUAGE_SLOT } from '../src/lib/language';
import { saveLanguage } from '../src/lib/languageStore';
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockStore.get(key) ?? null,
    getItemAsync: async (key: string) => mockStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { mockStore.set(key, value); },
    deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));
jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
const session = { signedIn: false, canReloadSession: () => false };
const active = ACTIVE_LOCALES;
function fixture(nativeRtl = false) {
    const deps: DirectionDependencies = {
        read: async () => mockStore.get(DIRECTION_SLOT) ?? null,
        write: jest.fn(async value => { if (value === null) mockStore.delete(DIRECTION_SLOT); else mockStore.set(DIRECTION_SLOT, value); }),
        nativeRtl: () => nativeRtl, direction: jest.fn(), reload: jest.fn(async () => {}),
    };
    return deps;
}
beforeEach(() => mockStore.clear());
test.each([
    { stored: 'ar', tags: ['en'], native: false, target: true },
    { stored: null, tags: ['ar-SA'], native: false, target: true },
    { stored: 'de', tags: ['ar'], native: true, target: false },
])('repairs stored=$stored tags=$tags native=$native without writing a choice', async ({ stored, tags, native, target }) => {
    if (stored) await saveLanguage(stored, true);
    const before = mockStore.get(LANGUAGE_SLOT);
    const locale = startupLocale(stored, tags, active);
    const deps = fixture(native), runtime = createDirectionReconciler(deps);
    expect(await runtime.reconcile(locale, '/account', session)).toBe(true);
    expect(deps.direction).toHaveBeenCalledWith(target);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(mockStore.get(LANGUAGE_SLOT)).toBe(before);
    expect(JSON.parse(mockStore.get(DIRECTION_SLOT)!)).toEqual({ locale, returnPath: '/account' });
    const afterReload = createDirectionReconciler(fixture(target));
    expect(await afterReload.reconcile(locale, '/', session)).toBe(true);
    expect(afterReload.handledRepair()).toBe(true);
    expect(afterReload.takeReturnPath()).toBe('/account');
    expect(afterReload.takeReturnPath()).toBeNull();
    expect(mockStore.get(LANGUAGE_SLOT)).toBe(before);
    expect(needsLanguageChoice(stored, active)).toBe(stored === null);
});
test('a reload that does not fix native direction cannot loop, and a later launch retries', async () => {
    const deps = fixture();
    const first = createDirectionReconciler(deps);
    await Promise.all([first.reconcile('ar', '/sign-in', session), first.reconcile('ar', '/sign-in', session)]);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    const next = createDirectionReconciler(deps);
    expect(await next.reconcile('ar', '/', session)).toBe(false);
    expect(await next.reconcile('ar', '/', session)).toBe(false);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    await createDirectionReconciler(deps).reconcile('ar', '/', session);
    expect(deps.reload).toHaveBeenCalledTimes(2);
});
test.each(['read', 'write', 'reload', 'session', 'lostSession'] as const)('%s failure keeps running, without repeated reloads', async failure => {
    const deps = fixture();
    const auth = { signedIn: true, canReloadSession: jest.fn(() => true) };
    if (failure === 'session') auth.canReloadSession.mockReturnValue(false);
    if (failure === 'lostSession') auth.canReloadSession.mockReturnValueOnce(true).mockReturnValue(false);
    if (failure === 'read') deps.read = async () => { throw Error('read'); };
    if (failure === 'write') deps.write = jest.fn(async () => { throw Error('write'); });
    if (failure === 'reload') deps.reload = jest.fn(async () => { throw Error('reload'); });
    const runtime = createDirectionReconciler(deps);
    expect(await runtime.reconcile('ar', '/', auth)).toBe(false);
    expect(await runtime.reconcile('ar', '/', auth)).toBe(false);
    expect(deps.reload).toHaveBeenCalledTimes(failure === 'reload' ? 1 : 0);
    if (failure !== 'reload') expect(deps.direction).not.toHaveBeenCalled();
    expect(mockStore.has(LANGUAGE_SLOT)).toBe(false);
});
test('default SecureStore adapter keeps an existing pending account sync byte-for-byte', async () => {
    await saveLanguage('ar', true);
    const before = mockStore.get(LANGUAGE_SLOT);
    await createDirectionReconciler().reconcile('ar', '/language', { signedIn: true, canReloadSession: () => true });
    expect(mockStore.get(LANGUAGE_SLOT)).toBe(before);
    expect(JSON.parse(before!).pendingAccountSync).toBe(true);
});

test.each(['before preparation', 'after preparation'] as const)('retries in the same launch when session recovers %s, then reloads only once', async stage => {
    const deps = fixture();
    const auth = { signedIn: true, canReloadSession: jest.fn(() => false) };
    if (stage === 'after preparation') auth.canReloadSession.mockReturnValueOnce(true);
    const runtime = createDirectionReconciler(deps);
    expect(await runtime.reconcile('ar', '/account', auth)).toBe(false);
    expect(runtime.handledRepair()).toBe(false);
    expect(mockStore.has(DIRECTION_SLOT)).toBe(false);
    expect(deps.direction).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    auth.canReloadSession.mockReturnValue(true);
    await Promise.all([runtime.reconcile('ar', '/account', auth), runtime.reconcile('ar', '/account', auth)]);
    await runtime.reconcile('ar', '/account', auth);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.direction).toHaveBeenCalledTimes(1);
    expect(runtime.reloadRequested()).toBe(true);
    expect(JSON.parse(mockStore.get(DIRECTION_SLOT)!)).toEqual({ locale: 'ar', returnPath: '/account' });
});

test('explicit choice waits for repair and cannot race a requested reload', async () => {
    let release!: () => void;
    const deps = fixture();
    deps.reload = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const runtime = createDirectionReconciler(deps);
    const repair = runtime.reconcile('ar', '/sign-in', session);
    // Wait for storage prerequisites before allowing the simulated reload to finish.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const ready = jest.fn();
    const choice = runtime.beforeChoice().then(ready);
    expect(ready).not.toHaveBeenCalled();
    release();
    await repair; await choice;
    expect(ready).toHaveBeenCalledWith(false);
});


test('startup return routes preserve query arrays and fragments without duplicating path parameters', () => {
    expect(languageReturnPath('/cinema/title', { id: 'title', filter: ['new', 'saved'], '#': 'preview' }, ['cinema', '[id]']))
        .toBe('/cinema/title?filter=new&filter=saved#preview');
    expect(languageReturnPath('/oauth-consent', { authorization_id: 'id+/=' }, ['oauth-consent']))
        .toBe('/oauth-consent?authorization_id=id%2B%2F%3D');
});
