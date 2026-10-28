import { numberText, currencyText } from './numbers';
import { isRtl, matchTag, resolveLocale, type LocaleCode } from './locales';
import { rawText, createTranslator, type Translator, type Vars } from './translate';
import { CATALOGS } from './catalogs';
export { CATALOGS, WEB_CATALOGS, APP_CATALOGS, CATALOG_LOADERS, loadCatalog } from './catalogs';
import { readLanguage } from '../languageStore';
import { deviceLanguageTags, readDeviceSources, resolveActive } from './device';

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
export const formatNumber = (value: number, decimals?: number): string => numberText(current.locale, value, decimals);
export const formatCurrency = (value: number, currency: string): string => currencyText(current.locale, value, currency);
export const formatLocale = (english?: string): string | undefined => current.locale === 'en' ? english : current.locale;
// English keeps plain numbers in messages (unchanged from before); other locales get their own digits and separators.
const localizedVars = (vars?: Vars): Vars | undefined => !vars || current.locale === 'en' ? vars : Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, typeof value === 'number' ? formatNumber(value) : value]));
export const t = (key: string, vars?: Vars): string => current.t(key, localizedVars(vars));
export const plural = (key: string, count: number, vars?: Vars): string => current.plural(key, count, localizedVars({ count, ...vars }));

export * from './locales';
export { deviceLanguageTags, resolveActive, splitSlots, type SlotPiece } from './device';
export { createTranslator, fill } from './translate';

// Accessibility and protocol consumers must never receive display isolation marks.
export { rawText } from './translate';
export const tAccessibility = (key: string, vars?: Vars): string => rawText(t(key, vars));
