import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';

const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
const KEY = 'app.create.templateReferenceOverrides';
const page = readFileSync('app/veyrnox/app/create/page.js', 'utf8');

test('a template run with a picture attached warns that the picture sets the scene', () => {
  assert.match(page, /activeTemplate && Object\.values\(sources\)\.flatMap\(sourceList\)\.length > 0/);
  assert.match(page, /data-testid="template-reference-overrides"/);
  assert.match(page, /t\('app\.create\.templateReferenceOverrides'\)/);
});

test('a template on a model that takes no files offers no Add files slot', () => {
  assert.match(page, /!\(activeTemplate && Object\.keys\(media\)\.length === 0\) && <>/);
  assert.match(page, /data-testid="create-add-files"[^>]*onClick=\{\(\) => setAddFilesOpen\(true\)\}/);
});

test('the warning is written in every app language', async () => {
  for (const locale of LOCALES) {
    const messages = await appMessagesFor(locale);
    assert.equal(typeof messages[KEY], 'string', locale);
    assert.ok(messages[KEY].length > 40, locale);
  }
});
