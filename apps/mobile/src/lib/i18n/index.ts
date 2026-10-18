import { DEFAULT_LOCALE, isRtl, resolveLocale, type LocaleCode } from './locales';
import { createTranslator, type Catalogs, type Translator, type Vars } from './translate';
import en from './messages/en';

// Only English ships until the localization process delivers the other catalogs; add each as `<code>: import(...)`
// here in the PR that receives it. A language without a catalog reads English, never a bare key.
export const CATALOGS: Catalogs = { en };

let current: Translator = createTranslator(DEFAULT_LOCALE, CATALOGS);

export function setLocaleFromDevice(tags: readonly string[]): LocaleCode {
    current = createTranslator(resolveLocale(tags), CATALOGS);
    return current.locale;
}

export const getLocale = (): LocaleCode => current.locale;
export const isRtlLocale = (): boolean => isRtl(current.locale);
export const t = (key: string, vars?: Vars): string => current.t(key, vars);
export const plural = (key: string, count: number, vars?: Vars): string => current.plural(key, count, vars);

export * from './locales';
export { createTranslator, fill } from './translate';
