'use client';
import { LOCALES, isLocalizedPath, languageAlternates, localizedPathKey } from '../../../lib/i18n/locales.mjs';
import { translator } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { rememberLocale } from '../../../lib/i18n/localeCookie.mjs';

// Plain links, one per language of the page being read, so it works without
// script and a crawler can follow it. `path` is the page's unprefixed path;
// a page with no translation shows no switcher.
export function LanguageSwitcher({ locale, path = '/' }) {
  const { languagesEnabled } = useI18n();
  const key = localizedPathKey(path);
  if (!languagesEnabled || !isLocalizedPath(key)) return null;
  const t = translator(locale);
  const alternates = languageAlternates(key);
  return (
    <nav aria-label={t('ui.language')} data-print="hide" className="max-w-[1300px] mx-auto px-4 sm:px-6 pb-8">
      <p className="text-xs text-vx-fg-muted">{t('ui.languageNote')}</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {LOCALES.map((l) => (
          <li key={l.code}>
            <a
              href={alternates[l.hreflang]}
              hrefLang={l.hreflang}
              lang={l.hreflang}
              aria-current={l.code === locale ? 'true' : undefined}
              data-locale={l.code}
              onClick={() => rememberLocale(l.code)}
              className={`inline-block py-1.5 hover:text-vx-fg ${l.code === locale ? 'font-bold text-vx-fg' : 'text-vx-fg-body underline underline-offset-4'}`}
            >
              <span aria-hidden="true">{l.flag}</span> {l.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
