// Per-language page metadata pieces (ADR-0107): the canonical for the language
// being read, and the hreflang set while languages are on.
import { LOCALES, languageAlternates, localeInfo, localesEnabled } from './locales.mjs';

/** { canonical, languages? } for `path` (an unprefixed path such as '/about') read in `locale`. */
export function pageAlternates(locale, path) {
  const canonical = locale === 'en' ? path : `/${locale}${path === '/' ? '' : path}`;
  return { canonical, ...(localesEnabled() ? { languages: languageAlternates(path) } : {}) };
}

/** Open Graph locale fields; empty while languages are off. */
export function openGraphLocale(locale) {
  if (!localesEnabled()) return {};
  return { locale: localeInfo(locale).og, alternateLocale: LOCALES.filter((l) => l.code !== locale).map((l) => l.og) };
}
