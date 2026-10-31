'use client';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { DEFAULT_LOCALE, localizedHref } from '../lib/i18n/locales.mjs';
import { isAppLocalePath } from '../lib/i18n/localeCookie.mjs';
import { ENGLISH, translator } from '../lib/i18n/translate.mjs';

// The language of the page being read, for client components. The root layout
// mounts this with the request's language and that language's own strings
// (lib/i18n/server.js); English is in the bundle, so an English reader gets no
// messages prop and no other language ever reaches the client. The app
// template nests a second provider carrying the app catalog only: it inherits
// the root's public strings while both read the same language (the root
// layout persists across client navigation, so after a public page in another
// language the app's public chrome reads English until a full load). With no
// provider (a test, a page outside the layout) everything reads as English.
const LocaleContext = createContext({ locale: DEFAULT_LOCALE, enabled: false });

export function I18nProvider({ locale, enabled = false, messages, children }) {
  const parent = useContext(LocaleContext);
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
  const inherited = parent.locale === activeLocale ? parent.messages : undefined;
  const value = useMemo(() => ({
    locale: activeLocale,
    enabled,
    messages: inherited || messages ? { ...inherited, ...messages } : undefined,
  }), [activeLocale, enabled, inherited, messages]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** { locale, languagesEnabled, t, href } for a client component. `href` adds the language prefix where a translation exists. */
export function useI18n() {
  const { locale, enabled, messages } = useContext(LocaleContext);
  return useMemo(() => ({
    locale,
    languagesEnabled: enabled,
    t: translator(locale, messages ? { ...ENGLISH, ...messages } : ENGLISH),
    href: (path) => localizedHref(locale, path),
  }), [locale, enabled, messages]);
}
