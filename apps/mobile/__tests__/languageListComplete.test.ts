import { activeLanguages } from '../src/lib/languageTransition';
import { LOCALE_CODES } from '../src/lib/i18n';
import { LANGUAGES } from '../src/lib/language';

test('the Language list offers every catalog the app ships, each under its own name', () => {
    const offered = activeLanguages().map(l => l.code);
    expect(offered).toEqual([...LOCALE_CODES]);
    expect(LANGUAGES.find(l => l.code === 'ja')?.name).toBe('日本語');
});
