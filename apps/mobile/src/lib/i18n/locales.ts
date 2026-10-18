// The app speaks the same eleven languages as the public site (ADR-0107), under the same codes.
export const LOCALE_CODES = ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko'] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en';

// Arabic is the one right-to-left language we ship.
const RTL: ReadonlySet<LocaleCode> = new Set(['ar']);

export function isLocaleCode(value: string): value is LocaleCode {
    return (LOCALE_CODES as readonly string[]).includes(value);
}

export function isRtl(locale: LocaleCode): boolean {
    return RTL.has(locale);
}

// Maps one BCP 47 tag ("pt-BR", "zh-Hans-CN", "en_GB") to a supported code, or null.
export function matchTag(tag: string): LocaleCode | null {
    const language = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    return isLocaleCode(language) ? language : null;
}

// The device lists its languages in preference order; the first one we ship wins, English otherwise.
export function resolveLocale(tags: readonly string[]): LocaleCode {
    for (const tag of tags) {
        const match = matchTag(tag);
        if (match) return match;
    }
    return DEFAULT_LOCALE;
}
