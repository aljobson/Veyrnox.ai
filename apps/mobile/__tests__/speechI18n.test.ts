import en from '../src/lib/i18n/messages/en/speech';
import ar from '../src/lib/i18n/messages/app/ar';
import de from '../src/lib/i18n/messages/app/de';
import es from '../src/lib/i18n/messages/app/es';
import fr from '../src/lib/i18n/messages/app/fr';
import hi from '../src/lib/i18n/messages/app/hi';
import ja from '../src/lib/i18n/messages/app/ja';
import ko from '../src/lib/i18n/messages/app/ko';
import pt from '../src/lib/i18n/messages/app/pt';
import ru from '../src/lib/i18n/messages/app/ru';
import zh from '../src/lib/i18n/messages/app/zh';
import { TTS_VOICES, TTS_EMOTIONS, TTS_INTERJECTIONS, TTS_EXAMPLES, voiceGenderOptions } from '../src/lib/speech/shared';
const keys = Object.keys(en).sort();
const creditFamilies = ['speech.price', 'speech.balance', 'speech.shortfall', 'speech.generate'];
const pluralFamilies = [...creditFamilies, ...['price', 'remaining', 'generate', 'stopped', 'uncertain'].map(key => `speech.audition.${key}`)];
const isCreditForm = (key: string) => pluralFamilies.some(base => key.startsWith(base + '.'));
const sourceFor = (key: string) => (en as Record<string, string>)[key] ?? (en as Record<string, string>)[key.replace(/\.[^.]+$/, '.other')];
const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
test.each(Object.entries({ ar, de, es, fr, hi, ja, ko, pt, ru, zh }))('%s speech keys and placeholders match English', (locale, messages) => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const expected = [...keys.filter(key => !isCreditForm(key)), ...pluralFamilies.flatMap(base => categories.map(category => `${base}.${category}`))].sort();
    expect(Object.keys(messages).filter(key => key.startsWith('speech.')).sort()).toEqual(expected);
    for (const key of expected) {
        const value = (messages as Record<string, string>)[key];
        expect(value.trim()).not.toBe(''); expect(slots(value)).toEqual(slots(sourceFor(key)));
    }
});
test('dynamic shared choices all have translations', () => {
    const dynamic = [...TTS_VOICES.map(voice => `speech.tone.${voice.tone}`), ...TTS_EMOTIONS.map(value => `speech.emotion.${value}`), ...voiceGenderOptions().map(value => `speech.gender.${value}`),
        ...TTS_INTERJECTIONS.map(([, cue]) => `speech.cue.${cue.slice(1, -1)}`), ...TTS_EXAMPLES.map((_, index) => `speech.example.${index}`)];
    for (const key of dynamic) expect(keys).toContain(key);
});

test('English credit families distinguish one and other; Arabic balance always names the unit', () => {
    for (const base of creditFamilies) {
        expect(sourceFor(`${base}.one`)).toContain('{count}');
        expect(sourceFor(`${base}.one`)).not.toBe(sourceFor(`${base}.other`));
    }
    for (const category of new Intl.PluralRules('ar').resolvedOptions().pluralCategories) {
        expect((ar as Record<string, string>)[`speech.balance.${category}`]).toContain('كريدت');
    }
});
