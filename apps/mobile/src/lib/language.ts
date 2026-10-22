// The language the person picked in the Vibe Check (server ADR-0251). The list is the public site's (lib/i18n/locales.mjs,
// ADR-0107): the same eleven codes, each shown by its own name with its flag. tests/languageListParity.test.mjs keeps the
// two lists the same. Self-contained (no imports) so that test can load it directly.
export interface LanguageOption {
    readonly code: string;
    readonly flag: string;
    readonly name: string;
    readonly tag: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
    { code: 'en', flag: '🇬🇧', name: 'English', tag: 'en' },
    { code: 'es', flag: '🇪🇸', name: 'Español', tag: 'es' },
    { code: 'zh', flag: '🇨🇳', name: '简体中文', tag: 'zh-Hans' },
    { code: 'hi', flag: '🇮🇳', name: 'हिन्दी', tag: 'hi' },
    { code: 'ar', flag: '🇸🇦', name: 'العربية', tag: 'ar' },
    { code: 'fr', flag: '🇫🇷', name: 'Français', tag: 'fr' },
    { code: 'pt', flag: '🇧🇷', name: 'Português (Brasil)', tag: 'pt-BR' },
    { code: 'ru', flag: '🇷🇺', name: 'Русский', tag: 'ru' },
    { code: 'ja', flag: '🇯🇵', name: '日本語', tag: 'ja' },
    { code: 'de', flag: '🇩🇪', name: 'Deutsch', tag: 'de' },
    { code: 'ko', flag: '🇰🇷', name: '한국어', tag: 'ko' },
];

export const LANGUAGE_SLOT = 'veyrnox.language.v1';

export const isLanguageCode = (value: unknown): value is string => typeof value === 'string' && LANGUAGES.some((l) => l.code === value);

export const serializeLanguage = (code: string): string => JSON.stringify({ version: 1, locale: code });

// Anything unreadable or from another version reads as "never chose".
export function parseLanguage(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw) as { version?: unknown; locale?: unknown } | null;
        return v && !Array.isArray(v) && v.version === 1 && isLanguageCode(v.locale) ? v.locale : null;
    } catch {
        return null;
    }
}
