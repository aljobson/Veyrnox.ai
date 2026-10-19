// Loaded by the server only for app pages. Public client imports never reach
// these catalogs; the app template provider receives the selected catalog as props.
import { isLocale } from './locales.mjs';

const loaders = {
  en: () => import('./messages/app/en.mjs'),
  es: () => import('./messages/app/es.mjs'),
  zh: () => import('./messages/app/zh.mjs'),
  hi: () => import('./messages/app/hi.mjs'),
  ar: () => import('./messages/app/ar.mjs'),
  fr: () => import('./messages/app/fr.mjs'),
  pt: () => import('./messages/app/pt.mjs'),
  ru: () => import('./messages/app/ru.mjs'),
  ja: () => import('./messages/app/ja.mjs'),
  de: () => import('./messages/app/de.mjs'),
  ko: () => import('./messages/app/ko.mjs'),
};

export async function appMessagesFor(locale) {
  const code = isLocale(locale) ? locale : 'en';
  const [english, selected] = await Promise.all([loaders.en(), loaders[code]()]);
  return { ...english.default, ...selected.default };
}
