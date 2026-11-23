import { APP_CATALOGS } from '../src/lib/i18n';
import en from '../src/lib/i18n/messages/en';

const keys = (Object.keys(en) as Array<keyof typeof en>)
    .filter(key => /^(editorLocalExport|editorNativeMotion|editorPersonMask|editorSpeech\.auto)/.test(key));
const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();

test.each(Object.entries(APP_CATALOGS))('%s owns the production editor actions with exact placeholders', (_locale, catalog) => {
    expect(keys).toHaveLength(78);
    for (const key of keys) {
        expect({ key, present: Object.hasOwn(catalog, key) }).toEqual({ key, present: true });
        expect({ key, placeholders: placeholders(catalog[key]) }).toEqual({ key, placeholders: placeholders(en[key]) });
        if (key !== 'editorNativeMotion.progress') expect(catalog[key]).not.toBe(en[key]);
    }
});
