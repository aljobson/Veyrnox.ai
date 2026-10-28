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

function pluralCategory(locale: LocaleCode, count: number): string {
    try {
        return new Intl.PluralRules(locale).select(count);
    } catch {
        return count === 1 ? 'one' : 'other';
    }
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
