const LANGUAGE_NAMES = Object.freeze({ es: 'Spanish', zh: 'Simplified Chinese', hi: 'Hindi', ar: 'Arabic',
    fr: 'French', pt: 'Brazilian Portuguese', ru: 'Russian', ja: 'Japanese', de: 'German', ko: 'Korean' });
export const isAccountLocale = value => typeof value === 'string' && Object.hasOwn(LANGUAGE_NAMES, value);

export function languageInstruction(locale) {
    return isAccountLocale(locale)
        ? `Reply in ${LANGUAGE_NAMES[locale]} unless the person writes in another language; keep product names, credit amounts, prices, URLs and code unchanged.`
        : '';
}
