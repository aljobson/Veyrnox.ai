import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { messagesFor } from '../lib/i18n/catalogs.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const KEYS = ['presets.photoExample.title', 'presets.photoExample.face', 'presets.photoExample.fullBody', 'presets.photoExample.limits', 'presets.swap.refundedReason'];

test('every photo upload shows the required example on web and mobile', () => {
  for (const path of ['public/examples/photo-face.jpg', 'public/examples/photo-full-body.jpg', 'apps/mobile/assets/examples/photo-face.jpg', 'apps/mobile/assets/examples/photo-full-body.jpg']) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
  for (const path of ['app/veyrnox/_components/SwapComposer.js', 'app/veyrnox/_components/TemplatePhotoSlots.js', 'app/veyrnox/_components/UseTemplate.js', 'apps/mobile/src/components/templates/SwapComposer.tsx', 'apps/mobile/src/components/TemplatePhotoSlots.tsx']) assert.match(read(path), /<TemplatePhotoExample/, path);
});

test('the swap status follows Generate, so progress is on screen after the tap', () => {
  const recipe = read('app/veyrnox/_components/TemplateRecipe.js');
  assert.ok(recipe.indexOf('<UseTemplate preset={preset} templateSwap={resolvedSwap.offer} /><SwapAttemptStatus') > 0);
  const status = read('app/veyrnox/_components/SwapAttemptStatus.js');
  assert.match(status, /scrollIntoView/);
  assert.match(status, /presets\.swap\.refundedReason/);
  const phone = read('apps/mobile/src/app/(app)/templates/[id].tsx');
  assert.ok(phone.indexOf('<SwapComposer offer=') < phone.lastIndexOf('<SwapAttemptStatus templateId={id} />'));
});

test('example and failure copy exists in every site language', () => {
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const messages = messagesFor(locale);
    for (const key of KEYS) assert.ok(messages[key], `${locale}: ${key}`);
  }
});
