import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('native Studio assistant translations load when Intl.PluralRules is unavailable', () => {
  const moduleUrl = new URL('../lib/i18n/musicStudioAssistantTranslations.mjs', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
    Intl.PluralRules = undefined;
    const translations = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify({
      locales: Object.keys(translations.MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS).length,
      englishOther: translations.MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS.en['studioAssistant.tracks.other'],
    }));
  `], { encoding: 'utf8' });

  const result = JSON.parse(output);
  assert.equal(result.locales, 11);
  assert.equal(result.englishOther, '{count} tracks in this beat.');
});
