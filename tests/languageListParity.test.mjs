import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '../lib/i18n/locales.mjs';
// Node strips the type annotations; the phone's file is self-contained for this reason.
import { LANGUAGES, parseLanguage, serializeLanguage, isLanguageCode, LANGUAGE_SLOT } from '../apps/mobile/src/lib/language.ts';

test('the phone offers exactly the site\'s languages, with the same flags, names and tags, in the same order', () => {
    assert.deepEqual(LANGUAGES.map((l) => ({ code: l.code, flag: l.flag, name: l.name, tag: l.tag })), LOCALES.map((l) => ({ code: l.code, flag: l.flag, name: l.name, tag: l.hreflang })));
});

test('every language shows its flag and its own name', () => {
    for (const l of LANGUAGES) { assert.match(l.flag, /^\p{Regional_Indicator}{2}$/u, l.code); assert.ok(l.name.trim(), l.code); }
    assert.equal(LANGUAGES.length, 11, 'English and the ten languages');
});

test('the saved choice round-trips and anything else reads as "never chose"', () => {
    for (const l of LANGUAGES) assert.equal(parseLanguage(serializeLanguage(l.code)), l.code);
    for (const bad of [null, undefined, '', 'x', '[]', 'null', JSON.stringify({ version: 2, locale: 'de' }), JSON.stringify({ version: 1, locale: 'xx' }), JSON.stringify({ version: 1 })]) assert.equal(parseLanguage(bad), null, String(bad));
    assert.equal(isLanguageCode('de'), true); assert.equal(isLanguageCode('xx'), false);
    assert.match(LANGUAGE_SLOT, /^veyrnox\./);
});
