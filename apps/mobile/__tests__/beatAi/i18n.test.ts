import { APP_CATALOGS } from '../../src/lib/i18n';
import messages from '../../src/lib/i18n/messages/en/beatAi';
import { buildDraft, phoneTranslator } from '../../src/lib/beatAi/draft';
import { doc } from './fixtures';
test.each(Object.entries(APP_CATALOGS))('%s supplies all Beat AI strings and placeholders', (_locale, own) => {
    for (const [key, value] of Object.entries(messages)) {
        const translated = (own as Record<string, string>)[key];
        expect(translated?.trim()).toBeTruthy();
        expect((translated.match(/\{\w+\}/g) ?? []).sort()).toEqual((value.match(/\{\w+\}/g) ?? []).sort());
    }
});
test('unknown web copy becomes a phone generic message; stems use the normal source requirement', () => {
    expect(phoneTranslator('app.music.beat.ai.a999')).not.toContain('app.music');
    expect(() => buildDraft(doc(), 'stems', '', '', '', true, null, null)).toThrow('source_required');
});
