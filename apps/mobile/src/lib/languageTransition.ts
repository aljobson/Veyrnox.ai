import { reloadAppAsync } from 'expo';
import { I18nManager } from 'react-native';
import { ACTIVE_LOCALES, getLocale, isRtl, type LocaleCode } from './i18n';
import { LANGUAGES } from './language';
import { loadLanguage, saveLanguage } from './languageStore';
import { saveThemeReturnPath } from '../theme';

export const activeLanguages = (active: readonly LocaleCode[] = ACTIVE_LOCALES) => LANGUAGES.filter(l => active.includes(l.code as LocaleCode));
export const hasActiveChoice = (stored: string | null, active: readonly LocaleCode[] = ACTIVE_LOCALES) => stored !== null && active.includes(stored as LocaleCode);
export const needsLanguageChoice = (stored: string | null, active: readonly LocaleCode[] = ACTIVE_LOCALES) => active.length > 1 && !hasActiveChoice(stored, active);

export interface LanguageTransition {
    active: readonly LocaleCode[];
    current: LocaleCode;
    signedIn: boolean;
    canReloadSession(): boolean;
    load(): Promise<string | null>;
    save(code: string | null, pendingAccountSync?: boolean): Promise<boolean>;
    onChosen(code: string): Promise<void>;
    saveReturn(path: string | null): Promise<boolean>;
    direction(rtl: boolean): void;
    reload(): Promise<void>;
}
let changing = false;
// Keep the live translator unchanged. Reload initializes it before any screen or module captures strings.
export async function changeLanguage(code: string, returnPath: string, session: { signedIn: boolean; canReloadSession(): boolean }, overrides: Partial<LanguageTransition> = {}): Promise<boolean> {
    if (changing) return false;
    const deps: LanguageTransition = {
        active: ACTIVE_LOCALES, current: getLocale(), ...session,
        onChosen: async () => {},
        load: loadLanguage, save: saveLanguage, saveReturn: saveThemeReturnPath,
        direction: rtl => { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); },
        reload: () => reloadAppAsync('Veyrnox language changed'), ...overrides,
    };
    if (!deps.active.includes(code as LocaleCode)) return false;
    if (code === deps.current) return true;
    if (deps.signedIn && !deps.canReloadSession()) return false;
    changing = true;
    let previous: string | null = null;
    let reloaded = false;
    let saved = false;
    let routeSaved = false;
    let directionChanged = false;
    try {
        previous = await deps.load();
        // Prepare route first: a route failure cannot leave a new language in storage.
        routeSaved = await deps.saveReturn(returnPath);
        if (!routeSaved) return false;
        saved = await deps.save(code, !deps.signedIn);
        if (!saved || (deps.signedIn && !deps.canReloadSession())) throw new Error('language_not_durable');
        if (isRtl(code as LocaleCode) !== isRtl(deps.current)) {
            directionChanged = true;
            deps.direction(isRtl(code as LocaleCode));
        }
        await deps.onChosen(code);
        if (deps.signedIn && !deps.canReloadSession()) throw new Error('language_not_durable');
        await deps.reload();
        reloaded = true;
        return true;
    } catch {
        if (saved) await deps.save(previous);
        try { if (directionChanged) deps.direction(isRtl(deps.current)); } catch { /* Keep the live language. */ }
        return false;
    } finally {
        // A real reload tears down this runtime. On rejection, remove the prepared return route.
        if (routeSaved && !reloaded) await deps.saveReturn(null);
        changing = false;
    }
}
