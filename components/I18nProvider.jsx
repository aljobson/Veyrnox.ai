'use client';
import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, localizedHref } from '../lib/i18n/locales.mjs';
import { translator } from '../lib/i18n/translate.mjs';

// The language of the page being read, for client components. The root layout
// mounts this with the request's language; with no provider (a test, a page
// outside the layout) everything reads as English.
const LocaleContext = createContext({ locale: DEFAULT_LOCALE, enabled: false });

export function I18nProvider({ locale, enabled = false, children }) {
  const value = useMemo(() => ({ locale, enabled }), [locale, enabled]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** { locale, languagesEnabled, t, href } for a client component. `href` adds the language prefix where a translation exists. */
export function useI18n() {
  const { locale, enabled } = useContext(LocaleContext);
  return useMemo(() => ({
    locale,
    languagesEnabled: enabled,
    t: translator(locale),
    href: (path) => localizedHref(locale, path),
  }), [locale, enabled]);
}
