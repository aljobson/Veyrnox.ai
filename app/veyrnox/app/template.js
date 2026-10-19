import { I18nProvider } from '../../../components/I18nProvider';
import { getT } from '../../../lib/i18n/server';
import { localeInfo, localesEnabled } from '../../../lib/i18n/locales.mjs';

// A route boundary also loads messages when a public Link enters the app.
// Root layouts persist across navigation; the app template gets the new request.
export default async function AppTemplate({ children }) {
  const { locale, messages } = await getT();
  const info = localeInfo(locale);
  return (
    <I18nProvider locale={locale} enabled={localesEnabled()} messages={messages}>
      <div lang={info.hreflang} dir={info.dir} data-app-locale={locale}>{children}</div>
    </I18nProvider>
  );
}
