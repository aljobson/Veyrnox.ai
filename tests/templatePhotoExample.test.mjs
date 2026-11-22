import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { messagesFor } from '../lib/i18n/catalogs.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const KEYS = ['presets.photoExample.title', 'presets.photoExample.face', 'presets.photoExample.fullBody', 'presets.photoExample.limits', 'presets.photoExample.swapLimits', 'presets.photoExample.scene', 'presets.swap.refundedReason'];

test('every photo upload shows the required example on web and mobile', () => {
  for (const path of ['public/examples/photo-face.jpg', 'public/examples/photo-full-body.jpg', 'apps/mobile/assets/examples/photo-face.jpg', 'apps/mobile/assets/examples/photo-full-body.jpg']) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
  for (const path of ['app/veyrnox/_components/SwapComposer.js', 'app/veyrnox/_components/TemplatePhotoSlots.js', 'app/veyrnox/_components/UseTemplate.js', 'apps/mobile/src/components/templates/SwapComposer.tsx', 'apps/mobile/src/components/TemplatePhotoSlots.tsx', 'apps/mobile/src/app/(app)/create/[modelId].tsx']) assert.match(read(path), /<TemplatePhotoExample/, path);
});

test('the swap status follows Generate, so progress is on screen after the tap', () => {
  const recipe = read('app/veyrnox/_components/TemplateRecipe.js');
  assert.ok(recipe.indexOf('<UseTemplate preset={preset} templateSwap={resolvedSwap.offer} /><SwapAttemptStatus') > 0);
  const status = read('app/veyrnox/_components/SwapAttemptStatus.js');
  assert.doesNotMatch(status, /scrollIntoView/, 'a restored or background attempt must never move the page');
  const composer = read('app/veyrnox/_components/SwapComposer.js');
  assert.match(composer, /reveal\.current = true[\s\S]*swapActions\.submit/);
  assert.match(composer, /scrollIntoView/);
  assert.ok(composer.indexOf('data-swap-feedback') > composer.indexOf("t('presets.swap.generate')"));
  assert.match(status, /presets\.swap\.refundedReason/);
  const phone = read('apps/mobile/src/app/(app)/templates/[id].tsx');
  assert.ok(phone.indexOf('<SwapComposer offer=') < phone.lastIndexOf('<SwapAttemptStatus templateId={id} revealAttempt'));
});

test('every image-template entry carries the scene guide, and the full-body example obeys its own limits', () => {
  assert.match(read('apps/mobile/src/app/(app)/create/presets.tsx'), /photoGuide: 'scene'/);
  assert.match(read('apps/mobile/src/app/(app)/(tabs)/index.tsx'), /photoGuide: 'scene'/);
  assert.match(read('app/veyrnox/app/create/page.js'), /<TemplatePhotoExample kind="scene"/);
  const width = 440, height = 1073;
  assert.ok(Math.min(width, height) >= 300 && width / height >= .4);
  assert.match(read('app/veyrnox/_components/TemplatePhotoExample.js'), /width: 440, height: 1073/);
});

test('stated limits sit inside what each validator accepts', async () => {
  const { TEMPLATE_PHOTO_LIMITS: limits } = await import('../lib/templatePhotoGuidance.mjs');
  assert.deepEqual({ ...limits.upload.values }, { size: 20, side: 256 });
  assert.deepEqual({ ...limits.swap.values }, { size: 20, minSide: 300, maxSide: '8,000', megapixels: 24 });
  assert.match(read('lib/templateSwapCutout.mjs'), /Math\.min\(size\.width, size\.height\) < 300/);
  assert.match(read('apps/mobile/src/lib/templateSwap/photoPlan.ts'), /width \* height > 24_000_000/);
});

test('example and failure copy exists in every site language', () => {
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const messages = messagesFor(locale);
    for (const key of KEYS) assert.ok(messages[key], `${locale}: ${key}`);
  }
});
