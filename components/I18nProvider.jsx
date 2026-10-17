'use client';
import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, localizedHref } from '../lib/i18n/locales.mjs';
import { translator } from '../lib/i18n/translate.mjs';

// The language of the page being read, for client components. The root layout
// mounts this with the request's language; with no provider (a test, a page
// outside the layout) everything reads as English.
const LocaleContext = createContext(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** { locale, t, href } for a client component. `href` adds the language prefix where a translation exists. */
export function useI18n() {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({
    locale,
    t: translator(locale),
    href: (path) => localizedHref(locale, path),
  }), [locale]);
}
