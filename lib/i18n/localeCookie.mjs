import { DEFAULT_LOCALE, isLocale, localizedPathKey } from './locales.mjs';

export const LOCALE_COOKIE = 'veyrnox_locale';
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Admin remains English. Only page rendering may use this preference. */
export function isAppLocalePath(pathname) {
  const path = localizedPathKey(pathname);
  return (path === '/app' || path.startsWith('/app/'))
    && path !== '/app/admin' && !path.startsWith('/app/admin/');
}

/** Accept a Cookie header or cookie records; ambiguous duplicates are English. */
export function localeFromCookie(cookies) {
  const records = Array.isArray(cookies) ? cookies : [cookies];
  const values = records.flatMap(record => {
    if (typeof record === 'string') return record.split(';').flatMap(part => {
      const separator = part.indexOf('=');
      return separator >= 0 && part.slice(0, separator).trim() === LOCALE_COOKIE
        ? [part.slice(separator + 1).trim()] : [];
    });
    return record?.name === LOCALE_COOKIE ? [record.value] : [];
  });
  return values.length === 1 && isLocale(values[0]) ? values[0] : DEFAULT_LOCALE;
}

export function localeCookie(code, production = process.env.NODE_ENV === 'production') {
  const value = isLocale(code) && code !== DEFAULT_LOCALE ? code : '';
  return `${LOCALE_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${value ? YEAR_SECONDS : 0}${production ? '; Secure' : ''}`;
}

/** Called only by language controls, never by an API client. */
export function rememberLocale(code) {
  document.cookie = localeCookie(code);
}
