// The public-site catalog of one language, loaded on demand (ADR-0107). The
// root layout calls this on the server and hands the result to the client
// provider as props, so a visitor downloads their own language only; the
// English source travels in the bundle (lib/i18n/translate.mjs) as the
// fallback. Each loader is its own chunk wherever this module is bundled.
import { ENGLISH, withPresets } from './translate.mjs';
import { DEFAULT_LOCALE, isLocale } from './locales.mjs';

const loaders = {
  es: () => Promise.all([import('./messages/es.mjs'), import('./messages/presets/es/needs.mjs'), import('./messages/presets/es/steps.mjs')]),
  zh: () => Promise.all([import('./messages/zh.mjs'), import('./messages/presets/zh/needs.mjs'), import('./messages/presets/zh/steps.mjs')]),
  hi: () => Promise.all([import('./messages/hi.mjs'), import('./messages/presets/hi/needs.mjs'), import('./messages/presets/hi/steps.mjs')]),
  ar: () => Promise.all([import('./messages/ar.mjs'), import('./messages/presets/ar/needs.mjs'), import('./messages/presets/ar/steps.mjs')]),
  fr: () => Promise.all([import('./messages/fr.mjs'), import('./messages/presets/fr/needs.mjs'), import('./messages/presets/fr/steps.mjs')]),
  pt: () => Promise.all([import('./messages/pt.mjs'), import('./messages/presets/pt/needs.mjs'), import('./messages/presets/pt/steps.mjs')]),
  ru: () => Promise.all([import('./messages/ru.mjs'), import('./messages/presets/ru/needs.mjs'), import('./messages/presets/ru/steps.mjs')]),
  ja: () => Promise.all([import('./messages/ja.mjs'), import('./messages/presets/ja/needs.mjs'), import('./messages/presets/ja/steps.mjs')]),
  de: () => Promise.all([import('./messages/de.mjs'), import('./messages/presets/de/needs.mjs'), import('./messages/presets/de/steps.mjs')]),
  ko: () => Promise.all([import('./messages/ko.mjs'), import('./messages/presets/ko/needs.mjs'), import('./messages/presets/ko/steps.mjs')]),
};

/**
 * One language's own public strings, presets included, without the English
 * fill: what the client needs on top of the English it already has. `null`
 * for English (and for an unknown code), so the provider gets no prop at all.
 */
export async function publicCatalogFor(locale) {
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) return null;
  const [catalog, needs, steps] = await loaders[locale]();
  return withPresets(catalog.default, needs.default, steps.default);
}

/** The messages for one language, English filling any gap. */
export async function publicMessagesFor(locale) {
  const own = await publicCatalogFor(locale);
  return own ? { ...ENGLISH, ...own } : ENGLISH;
}
