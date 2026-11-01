import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';

const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
const KEYS = ['app.create.templateReferenceOverrides', 'app.create.templateReferenceRequired'];
const page = readFileSync('app/veyrnox/app/create/page.js', 'utf8');

test('a template run with a picture attached warns that the picture sets the scene', () => {
  // Only the selected model's own image slots count, so a video-only or leftover picture never triggers it.
  assert.match(page, /const templateImageCount = activeTemplate \? Object\.entries\(media\)\.filter\(\(\[, spec\]\) => spec\?\.kind === 'image'\)/);
  assert.match(page, /templateImageCount > 0 && \(/);
  assert.match(page, /templateImageRequired \? 'app\.create\.templateReferenceRequired' : 'app\.create\.templateReferenceOverrides'/);
  assert.match(page, /data-testid="template-reference-overrides"/);
});

test('a template on a model that takes no files offers no Add files slot', () => {
  assert.match(page, /!\(activeTemplate && Object\.keys\(media\)\.length === 0\) && <>/);
  assert.match(page, /data-testid="create-add-files"[^>]*onClick=\{\(\) => setAddFilesOpen\(true\)\}/);
});

test('the warning is written in every app language', async () => {
  for (const locale of LOCALES) {
    const messages = await appMessagesFor(locale);
    for (const key of KEYS) {
      assert.equal(typeof messages[key], 'string', `${locale} ${key}`);
      assert.ok(messages[key].length > 40, `${locale} ${key}`);
    }
  }
});
