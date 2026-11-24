import { CATALOGS, LOCALE_CODES } from '../../src/lib/i18n';
import en from '../../src/lib/i18n/messages/en';

const keys = [
    'music.create.lyrics_required', 'music.create.contract_stale', 'music.create.suno.offer', 'music.create.suno.model',
    'music.create.suno.style', 'music.create.suno.exclude', 'music.create.suno.selectStyles', 'music.create.suno.clear',
    'music.create.suno.excludeNote', 'music.create.suno.vocalGender', 'music.create.suno.gender.auto',
    'music.create.suno.gender.male', 'music.create.suno.gender.female', 'music.create.suno.styleWeight',
    'music.create.suno.weirdness', 'music.create.suno.duration', 'music.create.suno.variety',
    'music.create.noAccountCredits', 'music.create.payableCredits',
    'music.create.dailyAllowanceReset', 'music.create.dailyAllowanceUnavailable',
    'music.create.dailyAllowanceExhausted', 'music.create.daily_allowance_stale',
    ...Array.from({ length: 5 }, (_, index) => `music.create.suno.variety.${index}`),
    ...['cinematic', 'electronic', 'indie', 'jazz', 'pop', 'rock'].map(value => `music.create.suno.style.${value}`),
    'music.actions.editUnavailableForFormat',
] as const;
const slots = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test.each(LOCALE_CODES)('Suno strings are complete in %s with matching placeholders', locale => {
    const catalog = CATALOGS[locale]!;
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const localeKeys = [
        ...keys,
        ...['music.create.dailyAllowance', 'music.create.dailyAllowanceStatus']
            .flatMap(base => categories.map(category => `${base}.${category}`)),
    ];
    for (const key of localeKeys) {
        const englishKey = Object.hasOwn(en, key) ? key : key.replace(/\.(zero|two|few|many)$/, '.other');
        expect(typeof catalog[key]).toBe('string');
        expect(catalog[key]).not.toBe(key);
        expect(slots(catalog[key]!)).toEqual(slots((en as Record<string, string>)[englishKey]!));
    }
});
