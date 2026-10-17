// Public-site languages (ADR-0107). English is the source and lives at the
// bare path; every other language lives under its code (/es, /fr, ...).
// Behind LOCALES_ENABLED: only the exact string "true" turns languages on; it
// is "true" in staging and production, and a missing var is off.

export const DEFAULT_LOCALE = 'en';
export const LOCALES_FLAG = 'LOCALES_ENABLED';

// `name` is the language in its own script, shown in the switcher; `flag` is
// a country flag emoji beside it (a flag stands for a country, so it only
// labels the language, never replaces the name). `hreflang`
// is what search engines are told; the path code stays short.
export const LOCALES = [
  { code: 'en', flag: '🇬🇧', name: 'English', hreflang: 'en', dir: 'ltr', og: 'en_GB' },
  { code: 'es', flag: '🇪🇸', name: 'Español', hreflang: 'es', dir: 'ltr', og: 'es_ES' },
  { code: 'zh', flag: '🇨🇳', name: '简体中文', hreflang: 'zh-Hans', dir: 'ltr', og: 'zh_CN' },
  { code: 'hi', flag: '🇮🇳', name: 'हिन्दी', hreflang: 'hi', dir: 'ltr', og: 'hi_IN' },
  { code: 'ar', flag: '🇸🇦', name: 'العربية', hreflang: 'ar', dir: 'rtl', og: 'ar_AR' },
  { code: 'fr', flag: '🇫🇷', name: 'Français', hreflang: 'fr', dir: 'ltr', og: 'fr_FR' },
  { code: 'pt', flag: '🇧🇷', name: 'Português (Brasil)', hreflang: 'pt-BR', dir: 'ltr', og: 'pt_BR' },
  { code: 'ru', flag: '🇷🇺', name: 'Русский', hreflang: 'ru', dir: 'ltr', og: 'ru_RU' },
  { code: 'ja', flag: '🇯🇵', name: '日本語', hreflang: 'ja', dir: 'ltr', og: 'ja_JP' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch', hreflang: 'de', dir: 'ltr', og: 'de_DE' },
  { code: 'ko', flag: '🇰🇷', name: '한국어', hreflang: 'ko', dir: 'ltr', og: 'ko_KR' },
];

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

// Pages that have a translation. A language prefix on any other path sends the
// visitor to the English page instead of serving English under a second URL
// (duplicate content). Add a path here in the same change that translates it.
export const LOCALIZED_PATHS = new Set(['/', '/pricing', '/about', '/models', '/tools', '/developers', '/mcp']);

/** Only the exact string "true" turns languages on. Read per request. */
export function localesEnabled(env = process.env) {
  return Boolean(env) && typeof env === 'object' && env[LOCALES_FLAG] === 'true';
}

export function isLocale(code) {
  return BY_CODE.has(code);
}

export function localeInfo(code) {
  return BY_CODE.get(code) || BY_CODE.get(DEFAULT_LOCALE);
}

/**
 * Split /es/pricing into { locale: 'es', rest: '/pricing' }. A path with no
 * language prefix, or one for English (/en is not a URL we serve), has no locale.
 */
export function splitLocalePath(pathname) {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(String(pathname || ''));
  if (!match || match[1] === DEFAULT_LOCALE || !BY_CODE.has(match[1])) return { locale: null, rest: pathname };
  return { locale: match[1], rest: match[2] || '/' };
}

/** The path a page lives at once its prefix is gone, without a trailing slash (except "/"). */
export function localizedPathKey(rest) {
  const clean = String(rest || '/').split(/[?#]/)[0];
  return clean.length > 1 ? clean.replace(/\/+$/, '') : '/';
}

/**
 * A link for a visitor reading `locale`. Only pages that have a translation
 * take the prefix; everything else stays at its English address.
 *   localizedHref('es', '/')          -> '/es'
 *   localizedHref('es', '/#faq')      -> '/es#faq'
 *   localizedHref('es', '/pricing')   -> '/pricing'
 */
export function localizedHref(locale, href) {
  if (!locale || locale === DEFAULT_LOCALE || !isLocale(locale)) return href;
  const text = String(href || '');
  if (!text.startsWith('/') || text.startsWith('//')) return text;
  const tail = /[?#].*$/.exec(text)?.[0] || '';
  const path = text.slice(0, text.length - tail.length) || '/';
  if (!LOCALIZED_PATHS.has(localizedPathKey(path))) return text;
  return `/${locale}${path === '/' ? '' : path}${tail}`;
}

/** { hreflang: path } for every language of one page, plus x-default. */
export function languageAlternates(pathKey) {
  const key = localizedPathKey(pathKey);
  const out = {};
  for (const l of LOCALES) {
    out[l.hreflang] = l.code === DEFAULT_LOCALE ? key : `/${l.code}${key === '/' ? '' : key}`;
  }
  out['x-default'] = key;
  return out;
}

/**
 * Where choosing `code` takes a reader who is on `pathname` (the browser
 * path, prefix included). A translated page goes to its own translation;
 * a page with none goes to that language's home page, the one page that is
 * (and English, which it already is, stays put).
 */
export function switchLanguageHref(code, pathname) {
  const { rest } = splitLocalePath(pathname || '/');
  const here = localizedPathKey(rest);
  const translated = LOCALIZED_PATHS.has(here);
  // An untranslated page is English, so choosing English stays on it.
  if (code === DEFAULT_LOCALE) return translated ? here : rest || '/';
  const key = translated ? here : '/';
  return `/${code}${key === '/' ? '' : key}`;
}
