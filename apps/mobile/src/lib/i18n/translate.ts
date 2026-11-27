import { isRtl, DEFAULT_LOCALE, type LocaleCode } from './locales';

export type Messages = Readonly<Record<string, string>>;
export type Catalogs = Readonly<Partial<Record<LocaleCode, Messages>>>;
export type Vars = Readonly<Record<string, string | number>>;

const SLOT = /\{([a-zA-Z0-9_]+)\}/g;

// Fills {slot} placeholders. A slot with no value is left as written.
export const rawText = <T extends string | undefined>(value: T): T => value?.replace(/[\u2068\u2069]/g, '') as T;

export function fill(text: string, vars?: Vars, rtl = false): string {
    if (!vars) return text;
    return text.replace(SLOT, (whole, name: string) => (name in vars ? (rtl ? `\u2068${vars[name]}\u2069` : String(vars[name])) : whole));
}

export interface Translator {
    readonly locale: LocaleCode;
    // Looks the key up in the locale, then in English. A key in neither is returned as written, so a gap is visible in review.
    t(key: string, vars?: Vars): string;
    // Picks `${key}.${category}` for the count's plural category (CLDR), then `${key}.other`. {count} is filled in.
    plural(key: string, count: number, vars?: Vars): string;
}

export function fallbackPluralCategory(locale: LocaleCode, count: number): string {
    if (!Number.isFinite(count)) return 'other';
    const n = Math.abs(count);
    const i = Math.floor(n);
    const integer = Number.isInteger(n);
    if (locale === 'ja' || locale === 'ko' || locale === 'zh') return 'other';
    if (locale === 'en' || locale === 'de') return n === 1 ? 'one' : 'other';
    if (locale === 'es') {
        if (n === 1) return 'one';
        return integer && i !== 0 && i % 1_000_000 === 0 ? 'many' : 'other';
    }
    if (locale === 'fr' || locale === 'pt') {
        if (i === 0 || i === 1) return 'one';
        return integer && i !== 0 && i % 1_000_000 === 0 ? 'many' : 'other';
    }
    if (locale === 'hi') return i === 0 || n === 1 ? 'one' : 'other';
    if (locale === 'ru') {
        if (!integer) return 'other';
        const mod10 = i % 10, mod100 = i % 100;
        if (mod10 === 1 && mod100 !== 11) return 'one';
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
        return mod10 === 0 || mod10 >= 5 || (mod100 >= 11 && mod100 <= 14) ? 'many' : 'other';
    }
    if (locale === 'ar') {
        if (!integer) return 'other';
        if (i === 0) return 'zero';
        if (i === 1) return 'one';
        if (i === 2) return 'two';
        const mod100 = i % 100;
        if (mod100 >= 3 && mod100 <= 10) return 'few';
        if (mod100 >= 11 && mod100 <= 99) return 'many';
    }
    return 'other';
}

function pluralCategory(locale: LocaleCode, count: number): string {
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function') {
            return new Intl.PluralRules(locale).select(count);
        }
    } catch {
        // Fall through to the deterministic native implementation.
    }
    return fallbackPluralCategory(locale, count);
}

export function createTranslator(locale: LocaleCode, catalogs: Catalogs): Translator {
    const own = catalogs[locale];
    const english = catalogs[DEFAULT_LOCALE] ?? {};
    const lookup = (key: string): string | undefined => own?.[key] ?? english[key];

    return {
        locale,
        t: (key, vars) => fill(lookup(key) ?? key, vars, isRtl(locale)),
        plural: (key, count, vars) => {
            const category = pluralCategory(locale, count);
            // The locale's own forms win over English ones, including its `.other`.
            const text = own?.[`${key}.${category}`] ?? own?.[`${key}.other`] ?? english[`${key}.${category}`] ?? english[`${key}.other`] ?? key;
            return fill(text, { count, ...vars }, isRtl(locale));
        },
    };
}
