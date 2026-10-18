'use client';

import { useSyncExternalStore } from 'react';
import ErrorRecovery from '../components/ErrorRecovery';
import { I18nProvider } from '../components/I18nProvider';
import { isLocalizedPath, localeInfo, splitLocalePath } from '../lib/i18n/locales.mjs';
import { translator } from '../lib/i18n/translate.mjs';

const subscribe = () => () => {};
const serverLocale = () => 'en';
const browserLocale = () => {
  const { locale, rest } = splitLocalePath(window.location.pathname);
  return locale && isLocalizedPath(rest) ? locale : 'en';
};

export default function GlobalError({ retry }) {
  // Next replaces the root layout here, including its request-bound provider.
  // Keep SSR/hydration consistent, then recover the validated public URL locale.
  const locale = useSyncExternalStore(subscribe, browserLocale, serverLocale);
  const info = localeInfo(locale);
  const t = translator(locale);
  return (
    <html lang={info.hreflang} dir={info.dir}>
      <head><title>{t('meta.siteTitle', { title: t('recovery.pageUnavailable') })}</title></head>
      <body style={{ margin: 0 }}>
        <I18nProvider locale={locale} enabled={locale !== 'en'}>
          <ErrorRecovery retry={retry} />
        </I18nProvider>
      </body>
    </html>
  );
}
