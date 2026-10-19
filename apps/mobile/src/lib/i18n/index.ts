import { DEFAULT_LOCALE, isRtl, resolveLocale, type LocaleCode } from './locales';
import { createTranslator, type Catalogs, type Translator, type Vars } from './translate';
import en from './messages/en';
import es from './messages/es';
import zh from './messages/zh';
import hi from './messages/hi';
import ar from './messages/ar';
import fr from './messages/fr';
import pt from './messages/pt';
import ru from './messages/ru';
import ja from './messages/ja';
import de from './messages/de';
import ko from './messages/ko';
import { deviceLanguageTags, readDeviceSources, resolveActive } from './device';

// Every language ships the web's translations of the strings the app shares with the site (generated, see
// scripts/sync-web-i18n.mjs); a key a language lacks reads English, never a bare key. Which languages are switched on is
// ACTIVE_LOCALES below.
export const CATALOGS: Catalogs = { en, es, zh, hi, ar, fr, pt, ru, ja, de, ko };

let current: Translator = createTranslator(DEFAULT_LOCALE, CATALOGS);

// Languages switched on for the app. The other catalogs ship with the web's translations of the strings the two
// share, but a screen would read as a mix until the localization process returns the app-only strings, so only
// English is on. Turning a language on is adding its code here (ADR-0132).
export const ACTIVE_LOCALES: readonly LocaleCode[] = ['en'];

// Called once at start: the device's first language that is switched on, else English.
export function applyDeviceLocale(): LocaleCode {
    current = createTranslator(resolveActive(deviceLanguageTags(readDeviceSources()), ACTIVE_LOCALES), CATALOGS);
    return current.locale;
}

export function setLocaleFromDevice(tags: readonly string[]): LocaleCode {
    current = createTranslator(resolveLocale(tags), CATALOGS);
    return current.locale;
}

export const getLocale = (): LocaleCode => current.locale;
export const isRtlLocale = (): boolean => isRtl(current.locale);
export const t = (key: string, vars?: Vars): string => current.t(key, vars);
export const plural = (key: string, count: number, vars?: Vars): string => current.plural(key, count, vars);

export * from './locales';
export { deviceLanguageTags, resolveActive, splitSlots, type SlotPiece } from './device';
export { createTranslator, fill } from './translate';
