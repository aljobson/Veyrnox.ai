import { DEFAULT_LOCALE, isRtl, matchTag, resolveLocale, type LocaleCode } from './locales';
import { createTranslator, type Catalogs, type Translator, type Vars } from './translate';
import en from './messages/en';
import es from './messages/es';
import appEs from './messages/app/es';
import zh from './messages/zh';
import appZh from './messages/app/zh';
import hi from './messages/hi';
import appHi from './messages/app/hi';
import ar from './messages/ar';
import appAr from './messages/app/ar';
import fr from './messages/fr';
import appFr from './messages/app/fr';
import pt from './messages/pt';
import appPt from './messages/app/pt';
import ru from './messages/ru';
import appRu from './messages/app/ru';
import ja from './messages/ja';
import appJa from './messages/app/ja';
import de from './messages/de';
import appDe from './messages/app/de';
import ko from './messages/ko';
import appKo from './messages/app/ko';
import { readLanguage } from '../languageStore';
import { deviceLanguageTags, readDeviceSources, resolveActive } from './device';

// Website keys always win; generated catalogs remain byte-for-byte copies of the site.
export const WEB_CATALOGS: Catalogs = { es, zh, hi, ar, fr, pt, ru, ja, de, ko };
export const APP_CATALOGS = { es: appEs, zh: appZh, hi: appHi, ar: appAr, fr: appFr, pt: appPt, ru: appRu, ja: appJa, de: appDe, ko: appKo } as const;
export const CATALOGS: Catalogs = {
    en,
    ...Object.fromEntries(Object.entries(APP_CATALOGS).map(([locale, app]) => [locale, { ...app, ...WEB_CATALOGS[locale as LocaleCode] }])),
};

// ADR-0270: all ten complete app catalogs, in LANGUAGES order.
export const ACTIVE_LOCALES: readonly LocaleCode[] = ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko'];

export function startupLocale(stored: string | null, tags: readonly string[], active = ACTIVE_LOCALES): LocaleCode {
    return resolveActive([...(stored ? [stored] : []), ...tags], active);
}
let current: Translator = createTranslator(startupLocale(readLanguage(), deviceLanguageTags(readDeviceSources())), CATALOGS);

// Device-only selector retained for translator tests; runtime startup also honors the stored choice.
export function applyDeviceLocale(): LocaleCode {
    current = createTranslator(resolveActive(deviceLanguageTags(readDeviceSources()), ACTIVE_LOCALES), CATALOGS);
    return current.locale;
}

export function setLocaleFromDevice(tags: readonly string[]): LocaleCode {
    current = createTranslator(resolveLocale(tags), CATALOGS);
    return current.locale;
}

// Low-level selector for tooling/tests. UI language changes must use changeLanguage and reload.
export function chooseLocale(code: string): boolean {
    const match = matchTag(code);
    if (!match || !ACTIVE_LOCALES.includes(match)) return false;
    current = createTranslator(match, CATALOGS);
    return true;
}

export const getLocale = (): LocaleCode => current.locale;
export const isRtlLocale = (): boolean => isRtl(current.locale);
// Preserve each English call site's existing region policy. Other languages use the app locale.
export const formatNumber = (value: number): string => current.locale === 'en' ? String(value) : value.toLocaleString(current.locale);
export const formatLocale = (english?: string): string | undefined => current.locale === 'en' ? english : current.locale;
const localizedVars = (vars?: Vars): Vars | undefined => current.locale === 'en' || !vars ? vars : Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, typeof value === 'number' ? value.toLocaleString(current.locale) : value]));
export const t = (key: string, vars?: Vars): string => current.t(key, localizedVars(vars));
export const plural = (key: string, count: number, vars?: Vars): string => current.plural(key, count, localizedVars({ count, ...vars }));

export * from './locales';
export { deviceLanguageTags, resolveActive, splitSlots, type SlotPiece } from './device';
export { createTranslator, fill } from './translate';
