import { headers } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, localesEnabled } from './locales.mjs';
import { translator } from './translate.mjs';
import { LOCALE_HEADER, PATH_HEADER } from './headerNames.mjs';

// The middleware strips a language prefix, rewrites to the English-named
// route and records the language in LOCALE_HEADER (it sets it to 'en' on every
// page request, so a client cannot choose one). Not an identity header: it
// only picks which words a page prints.

/** The language of this request; English when languages are off or unknown. */
export async function getLocale() {
  if (!localesEnabled()) return DEFAULT_LOCALE;
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** { locale, t } for a server component. */
export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}

/** The unprefixed path of this request (e.g. "/"), '' when unknown. */
export async function getSitePath() {
  return (await headers()).get(PATH_HEADER) || '';
}
