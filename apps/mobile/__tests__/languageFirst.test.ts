import { activeLanguages, changeLanguage, hasActiveChoice, needsLanguageChoice, type LanguageTransition } from '../src/lib/languageTransition';
import { getLocale, setLocaleFromDevice, startupLocale, formatLocale, t } from '../src/lib/i18n';
import { entryDate, creditsCount } from '../src/lib/creditHistory';
import { loadLanguage, saveLanguage, saveAccountLanguage, syncPendingAccountLanguage } from '../src/lib/languageStore';
import { saveThemeReturnPath, takeThemeReturnPath } from '../src/theme';

const mockStore = new Map<string, string>();
let mockWriteFail = false;
jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockStore.get(key) ?? null,
    getItemAsync: async (key: string) => mockStore.get(key) ?? null,
    setItem: (key: string, value: string) => { if (mockWriteFail) throw Error('storage'); mockStore.set(key, value); },
    setItemAsync: async (key: string, value: string) => { if (mockWriteFail) throw Error('storage'); mockStore.set(key, value); },
    deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));
jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
beforeEach(() => { mockStore.clear(); mockWriteFail = false; setLocaleFromDevice(['en']); });
function fixture(overrides: Partial<LanguageTransition> = {}): LanguageTransition {
    return { active: ['en', 'es', 'ar'], current: 'en', nativeRtl: false, reconcile: jest.fn(async () => true), signedIn: true, canReloadSession: () => true,
        load: async () => 'en', save: jest.fn(async () => true), saveReturn: jest.fn(async () => true),
        onChosen: jest.fn(async () => {}), direction: jest.fn(), reload: jest.fn(async () => {}), ...overrides };
}
test('English alone bypasses first launch; two active languages use LANGUAGES order and own names', () => {
    expect(needsLanguageChoice(null, ['en'])).toBe(false);
    expect(needsLanguageChoice(null, ['en', 'es'])).toBe(true);
    expect(activeLanguages(['es', 'en']).map(l => [l.code, l.name])).toEqual([['en', 'English'], ['es', 'Español']]);
    expect(needsLanguageChoice('es', ['en', 'es'])).toBe(false);
});
test('inactive saved choice falls back to device, then English, and does not suppress Vibe', () => {
    expect(startupLocale('ar', ['es-MX'], ['en', 'es'])).toBe('es');
    expect(startupLocale('ar', ['de-DE'], ['en', 'es'])).toBe('en');
    expect(startupLocale('en', ['es-MX'], ['en', 'es'])).toBe('en');
    expect(hasActiveChoice('ar', ['en', 'es'])).toBe(false);
});
test.each(['language', 'route', 'session'] as const)('%s failure keeps live locale and never reloads', async failure => {
    const deps = fixture({
        ...(failure === 'language' ? { save: jest.fn(async () => false) } : {}),
        ...(failure === 'route' ? { saveReturn: jest.fn(async () => false) } : {}),
        ...(failure === 'session' ? { canReloadSession: () => false } : {}),
    });
    expect(await changeLanguage('es', '/account', deps, deps)).toBe(false);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(getLocale()).toBe('en');
});
test('a session losing durability during storage rolls back the choice', async () => {
    const canReloadSession = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const deps = fixture({ canReloadSession });
    expect(await changeLanguage('es', '/account', deps, deps)).toBe(false);
    expect(deps.save).toHaveBeenLastCalledWith('en');
    expect(deps.reload).not.toHaveBeenCalled();
});
test('en to es reloads even though both are LTR, after both writes succeed', async () => {
    const calls: string[] = [];
    const deps = fixture({ save: async code => { calls.push(`language:${code}`); return true; }, saveReturn: async path => { calls.push(`route:${path}`); return true; }, reload: async () => { calls.push('reload'); } });
    expect(await changeLanguage('es', '/language', deps, deps)).toBe(true);
    expect(calls).toEqual(['route:/language', 'language:es', 'reload']);
    expect(deps.direction).not.toHaveBeenCalled();
    expect(getLocale()).toBe('en'); // The old runtime never partially switches.
});
test('first-launch reload returns to sign-in, without needing a signed-in credential', async () => {
    const deps = fixture({ signedIn: false, canReloadSession: () => false });
    expect(await changeLanguage('es', '/sign-in', deps, deps)).toBe(true);
    expect(deps.saveReturn).toHaveBeenCalledWith('/sign-in');
});
test.each([['ar', true, 'en'], ['es', false, 'ar']] as const)('%s sets the direction before reload', async (code, rtl, current) => {
    const deps = fixture({ current, nativeRtl: current === 'ar' });
    await changeLanguage(code, '/language', deps, deps);
    expect(deps.direction).toHaveBeenCalledWith(rtl);
    expect(deps.reload).toHaveBeenCalledTimes(1);
});
test('inactive languages cannot be selected', async () => {
    const deps = fixture({ active: ['en', 'es'] });
    expect(await changeLanguage('ar', '/language', deps, deps)).toBe(false);
    expect(deps.save).not.toHaveBeenCalled();
});
test('reload failure restores persisted language and clears prepared return route', async () => {
    const deps = fixture({ reload: async () => { throw Error('reload'); } });
    expect(await changeLanguage('es', '/language', deps, deps)).toBe(false);
    expect(deps.save).toHaveBeenLastCalledWith('en');
    expect(deps.saveReturn).toHaveBeenLastCalledWith(null);
});
test('real language and return-slot adapters report storage failures', async () => {
    expect(await saveLanguage('es')).toBe(true);
    expect(await loadLanguage()).toBe('es');
    expect(await saveThemeReturnPath('/sign-in')).toBe(true);
    expect(await takeThemeReturnPath()).toBe('/sign-in');
    mockWriteFail = true;
    expect(await saveLanguage('ar')).toBe(false);
    expect(await saveThemeReturnPath('/language')).toBe(false);
    expect(await loadLanguage()).toBe('es');
});
test('English on a German-region phone retains device dates and Credits en-GB/en-US', () => {
    const at = new Date(2026, 9, 27, 13, 15);
    expect(at.toLocaleDateString(formatLocale('de-DE'))).toBe(at.toLocaleDateString('de-DE'));
    expect(formatLocale()).toBeUndefined();
    expect(entryDate(at.toISOString())).toBe(at.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    expect(creditsCount(12345)).toBe('12,345 credits');
});
test('Spanish dates, calendar weekdays and Credits use the app language', () => {
    setLocaleFromDevice(['es']);
    const at = new Date(2026, 9, 27, 13, 15);
    expect(at.toLocaleDateString(formatLocale('de-DE'), { weekday: 'long' })).toBe('martes');
    expect(entryDate(at.toISOString())).toBe(at.toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    expect(creditsCount(12345)).toBe(`${(12345).toLocaleString('es')} créditos`);
    expect(t('label.Library')).not.toBe('Library');
});

test('account synchronization uses the existing language endpoint and English clears the setting', async () => {
    const request = jest.fn().mockResolvedValue({});
    await saveAccountLanguage({ request }, 'es');
    expect(request).toHaveBeenLastCalledWith('/api/v1/account/language', expect.objectContaining({ method: 'PUT', body: '{"locale":"es"}' }));
    await saveAccountLanguage({ request }, 'en');
    expect(request).toHaveBeenLastCalledWith('/api/v1/account/language', expect.objectContaining({ body: '{"locale":null}' }));
    request.mockRejectedValueOnce(Error('offline'));
    await expect(saveAccountLanguage({ request }, 'es')).resolves.toBeUndefined();
});

test('reselecting the current locale does no work, even for a memory-only session', async () => {
    const deps = fixture({ canReloadSession: () => false });
    expect(await changeLanguage('en', '/account', deps, deps)).toBe(true);
    for (const fn of [deps.save, deps.saveReturn, deps.direction, deps.reload, deps.onChosen]) expect(fn).not.toHaveBeenCalled();
});
test('signed-in choice sync runs before the reload destroys the runtime', async () => {
    const calls: string[] = [];
    const deps = fixture({ onChosen: async code => { calls.push(code); }, reload: async () => { calls.push('reload'); } });
    expect(await changeLanguage('es', '/language', deps, deps)).toBe(true);
    expect(deps.save).toHaveBeenCalledWith('es', false);
    expect(calls).toEqual(['es', 'reload']);
});
test('pre-sign-in choices sync once, ordinary saved preferences never overwrite the account', async () => {
    const request = jest.fn().mockResolvedValue({});
    await saveLanguage('es');
    await syncPendingAccountLanguage({ request }, ['en', 'es']);
    expect(request).not.toHaveBeenCalled();
    await saveLanguage('es', true);
    await syncPendingAccountLanguage({ request }, ['en', 'es']);
    await syncPendingAccountLanguage({ request }, ['en', 'es']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith('/api/v1/account/language', expect.objectContaining({ body: '{"locale":"es"}' }));
    expect(await loadLanguage()).toBe('es');
});
test('inactive or unconsumable pending choices do not sync', async () => {
    const request = jest.fn().mockResolvedValue({});
    await saveLanguage('ar', true);
    await syncPendingAccountLanguage({ request }, ['en', 'es']);
    await saveLanguage('es', true);
    mockWriteFail = true;
    await syncPendingAccountLanguage({ request }, ['en', 'es']);
    expect(request).not.toHaveBeenCalled();
});
