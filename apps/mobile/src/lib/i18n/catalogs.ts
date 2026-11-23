import en from './messages/en';
import musicAlbumsByLocale from './messages/musicAlbums';
import type { LocaleCode } from './locales';
import type { Catalogs, Messages } from './translate';

// Static requires are intentionally inside functions: Metro includes every locale,
// but only English and the selected locale are evaluated before first paint.
export const CATALOG_LOADERS = {
    es: { app: () => ({ ...require('./messages/app/es').default, ...musicAlbumsByLocale.es }), web: () => require('./messages/es').default },
    zh: { app: () => ({ ...require('./messages/app/zh').default, ...musicAlbumsByLocale.zh }), web: () => require('./messages/zh').default },
    hi: { app: () => ({ ...require('./messages/app/hi').default, ...musicAlbumsByLocale.hi }), web: () => require('./messages/hi').default },
    ar: { app: () => ({ ...require('./messages/app/ar').default, ...musicAlbumsByLocale.ar }), web: () => require('./messages/ar').default },
    fr: { app: () => ({ ...require('./messages/app/fr').default, ...musicAlbumsByLocale.fr }), web: () => require('./messages/fr').default },
    pt: { app: () => ({ ...require('./messages/app/pt').default, ...musicAlbumsByLocale.pt }), web: () => require('./messages/pt').default },
    ru: { app: () => ({ ...require('./messages/app/ru').default, ...musicAlbumsByLocale.ru }), web: () => require('./messages/ru').default },
    ja: { app: () => ({ ...require('./messages/app/ja').default, ...musicAlbumsByLocale.ja }), web: () => require('./messages/ja').default },
    de: { app: () => ({ ...require('./messages/app/de').default, ...musicAlbumsByLocale.de }), web: () => require('./messages/de').default },
    ko: { app: () => ({ ...require('./messages/app/ko').default, ...musicAlbumsByLocale.ko }), web: () => require('./messages/ko').default },
} satisfies Record<Exclude<LocaleCode, 'en'>, { app(): Messages; web(): Messages }>;

type TranslatedLocale = keyof typeof CATALOG_LOADERS;
const merged: Partial<Record<LocaleCode, Messages>> = { en };
export const WEB_CATALOGS: Catalogs = {};
export const APP_CATALOGS = {} as Readonly<Record<TranslatedLocale, Messages>>;
export const CATALOGS: Catalogs = { en };

export function loadCatalog(locale: LocaleCode): Messages {
    if (!merged[locale]) {
        // Website keys always win; generated catalogs remain byte-for-byte copies.
        merged[locale] = { ...APP_CATALOGS[locale as TranslatedLocale], ...WEB_CATALOGS[locale] };
    }
    return merged[locale]!;
}

// Enumerable getters preserve both direct access and the full-catalog review tools.
// Listing keys does not load a catalog; reading a value does.
for (const locale of Object.keys(CATALOG_LOADERS) as TranslatedLocale[]) {
    Object.defineProperty(WEB_CATALOGS, locale, { enumerable: true, get: CATALOG_LOADERS[locale].web });
    Object.defineProperty(APP_CATALOGS, locale, { enumerable: true, get: CATALOG_LOADERS[locale].app });
    Object.defineProperty(CATALOGS, locale, { enumerable: true, get: () => loadCatalog(locale) });
}
