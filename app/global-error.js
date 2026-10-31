'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import ErrorRecovery from '../components/ErrorRecovery';
import { I18nProvider } from '../components/I18nProvider';
import { isLocalizedPath, localeInfo, splitLocalePath } from '../lib/i18n/locales.mjs';
import { publicCatalogFor } from '../lib/i18n/publicMessages.mjs';
import { translator, ENGLISH } from '../lib/i18n/translate.mjs';

const subscribe = () => () => {};
const serverLocale = () => 'en';
const browserLocale = () => {
  const { locale, rest } = splitLocalePath(window.location.pathname);
  return locale && isLocalizedPath(rest) ? locale : 'en';
};

export default function GlobalError({ retry }) {
  // Next replaces the root layout here, including its request-bound provider
  // and the language it loaded. Keep SSR/hydration consistent, recover the
  // validated public URL locale, then fetch that language's own words: the
  // bundle carries English only, so the first paint is English.
  const locale = useSyncExternalStore(subscribe, browserLocale, serverLocale);
  const [messages, setMessages] = useState(null);
  useEffect(() => {
    let current = true;
    publicCatalogFor(locale).then(catalog => { if (current) setMessages(catalog); }, () => { /* English stays */ });
    return () => { current = false; };
  }, [locale]);
  const info = localeInfo(locale);
  const t = translator(locale, messages ? { ...ENGLISH, ...messages } : ENGLISH);
  return (
    <html lang={info.hreflang} dir={info.dir}>
      <head><title>{t('meta.siteTitle', { title: t('recovery.pageUnavailable') })}</title></head>
      <body style={{ margin: 0 }}>
        <I18nProvider locale={locale} enabled={locale !== 'en'} messages={messages ?? undefined}>
          <ErrorRecovery retry={retry} />
        </I18nProvider>
      </body>
    </html>
  );
}
