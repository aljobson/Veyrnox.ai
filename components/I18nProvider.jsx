'use client';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { DEFAULT_LOCALE, localizedHref } from '../lib/i18n/locales.mjs';
import { isAppLocalePath } from '../lib/i18n/localeCookie.mjs';
import { translator, messagesFor } from '../lib/i18n/translate.mjs';

// The language of the page being read, for client components. The root layout
// mounts this with the request's language; with no provider (a test, a page
// outside the layout) everything reads as English.
const LocaleContext = createContext({ locale: DEFAULT_LOCALE, enabled: false });

export function I18nProvider({ locale, enabled = false, messages, children }) {
  useEffect(() => {
    const navigate = event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin === window.location.origin && isAppLocalePath(target.pathname) !== isAppLocalePath(window.location.pathname)) {
        event.preventDefault();
        window.location.assign(target.href);
      }
    };
    document.addEventListener('click', navigate, true);
    return () => document.removeEventListener('click', navigate, true);
  }, []);
  const activeLocale = enabled ? locale : DEFAULT_LOCALE;
  const value = useMemo(() => ({ locale: activeLocale, enabled, messages }), [activeLocale, enabled, messages]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** { locale, languagesEnabled, t, href } for a client component. `href` adds the language prefix where a translation exists. */
export function useI18n() {
  const { locale, enabled, messages } = useContext(LocaleContext);
  return useMemo(() => ({
    locale,
    languagesEnabled: enabled,
    t: translator(locale, messages ? { ...messagesFor(locale), ...messages } : undefined),
    href: (path) => localizedHref(locale, path),
  }), [locale, enabled, messages]);
}
