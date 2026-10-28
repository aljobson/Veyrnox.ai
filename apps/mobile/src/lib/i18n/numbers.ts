import type { LocaleCode } from './locales';

// Hermes delegates Intl data to the OS. Check support on the running device rather
// than assuming that every OS image contains all eleven locales.
const supported = new Map<string, boolean>();
const formatters = new Map<string, Intl.NumberFormat>();
export function supportsNumberLocale(locale: LocaleCode): boolean {
    let ok = supported.get(locale);
    if (ok === undefined) {
        try { ok = Intl.NumberFormat.supportedLocalesOf([locale]).length === 1; } catch { ok = false; }
        supported.set(locale, ok);
    }
    return ok;
}
// For tests that change what Intl reports.
export function resetNumberFormatCache(): void { supported.clear(); formatters.clear(); }
function formatter(locale: LocaleCode, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const key = `${locale}|${JSON.stringify(options)}`;
    let f = formatters.get(key);
    if (!f) { f = new Intl.NumberFormat(locale, options); formatters.set(key, f); }
    return f;
}
export function numberText(locale: LocaleCode, value: number, decimals?: number): string {
    const options = decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
    try {
        if (supportsNumberLocale(locale)) return formatter(locale, options).format(value);
    } catch { /* Minimal OS images still get consistent digits and separators below. */ }
    const [integer, fraction] = (decimals === undefined ? String(value) : value.toFixed(decimals)).split('.');
    const comma = ['de', 'es', 'fr', 'pt', 'ru'].includes(locale);
    const group = locale === 'ar' ? '٬' : ['fr', 'ru'].includes(locale) ? '\u202f' : comma ? '.' : ',';
    const decimal = locale === 'ar' ? '٫' : comma ? ',' : '.';
    const text = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (fraction === undefined ? '' : decimal + fraction);
    return locale === 'ar' ? text.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]) : text;
}
export function currencyText(locale: LocaleCode, value: number, currency: string): string {
    try {
        if (supportsNumberLocale(locale)) return formatter(locale, { style: 'currency', currency }).format(value);
    } catch { /* Invalid/unsupported currency: preserve the amount in the active locale. */ }
    return `${numberText(locale, value, 2)} ${currency}`;
}
