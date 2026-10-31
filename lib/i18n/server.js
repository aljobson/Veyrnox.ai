import { headers } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, localesEnabled } from './locales.mjs';
import { ENGLISH, translator } from './translate.mjs';
import { publicCatalogFor } from './publicMessages.mjs';
import { LOCALE_HEADER, PATH_HEADER } from './headerNames.mjs';

// The middleware strips a language prefix, rewrites to the English-named
// route and records the validated language in LOCALE_HEADER. It overwrites
// incoming headers on every page request. Not an identity header: it
// only picks which words a page prints.

/** The language of this request; English when languages are off or unknown. */
export async function getLocale() {
  if (!localesEnabled()) return DEFAULT_LOCALE;
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// `messages` is what a client provider needs beyond the English in the bundle.
// For the root layout that is the request language's own public strings
// (undefined for English). For the app template it is the app catalog only:
// the nested provider inherits the public strings from the root provider
// (components/I18nProvider.jsx), so a document carries each catalog once.
// `t` always has everything, English filled in.
function bind(locale, messages, known = messages) {
  return { locale, t: translator(locale, known ? { ...ENGLISH, ...known } : ENGLISH), messages };
}

/** { locale, t, messages } for a public server component and the root layout. */
export async function getPublicT() {
  const locale = await getLocale();
  return bind(locale, (await publicCatalogFor(locale)) ?? undefined);
}

/** { locale, t, messages } for a server component; on an app page `messages` is the app catalog. */
export async function getT() {
  const { locale, messages } = await getPublicT();
  if (!/^\/app(?:\/|$)/.test(await getSitePath())) return bind(locale, messages);
  const { appMessagesFor } = await import('./appMessages.mjs');
  const app = await appMessagesFor(locale);
  return bind(locale, app, { ...messages, ...app });
}

/** The unprefixed path of this request (e.g. "/"), '' when unknown. */
export async function getSitePath() {
  return (await headers()).get(PATH_HEADER) || '';
}
