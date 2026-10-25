import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CREATIVE_FEATURES, CREATIVE_FEATURE_SLUGS, creativeFeature, creativeFeatureExample, creativeFeatureExampleAssetPath } from '../app/veyrnox/_lib/creativeFeatures.js';

const EXPECTED = [
  'ai-avatar-generator', 'talking-avatar', 'ai-human-generator', 'ai-influencer-generator',
  'text-to-speech', 'ai-voice-cloning', 'ai-hairstyle-changer', 'ai-hair-color-changer',
  'ai-baby-generator', 'lip-sync', 'ai-talking-photo-generator', 'singing-photo',
  'avatar-dialogue', 'video-dubbing', 'talking-cartoon', 'talking-animals',
  'ai-baby-podcast', 'talking-objects', 'ai-ad-clone', 'product-avatar',
  'product-video-generator', 'product-image-generator',
];

test('the workflow registry covers every requested feature exactly once', () => {
  assert.deepEqual(CREATIVE_FEATURE_SLUGS, EXPECTED);
  assert.equal(new Set(CREATIVE_FEATURE_SLUGS).size, EXPECTED.length);
});

test('every live workflow has a model, brief and three-step handoff', () => {
  for (const item of CREATIVE_FEATURES) {
    assert.equal(creativeFeature(item.slug), item);
    assert.ok(item.title && item.group && item.kind && item.input);
    assert.equal(item.steps.length, 3);
    if (!item.blocked) assert.ok(item.model);
  }
});

test('every workflow exposes a real, required upload control', () => {
  for (const item of CREATIVE_FEATURES) {
    assert.ok(item.media.length > 0 || item.scriptUpload, `${item.slug} needs an upload`);
  }
  const textToSpeech = creativeFeature('text-to-speech');
  assert.equal(textToSpeech.scriptUpload, true);
  assert.equal(textToSpeech.model, 'inworld-tts');
  assert.deepEqual(textToSpeech.media, []);
  for (const slug of ['ai-avatar-generator', 'ai-human-generator', 'ai-influencer-generator', 'ai-baby-generator', 'product-image-generator']) {
    const item = creativeFeature(slug);
    assert.equal(item.model, 'nano-banana-pro-edit-grsai');
    assert.deepEqual(item.media, ['image']);
  }
});

test('every workflow has an exact, attributable reference example', () => {
  for (const item of CREATIVE_FEATURES) {
    const example = creativeFeatureExample(item.slug);
    assert.ok(example, `${item.slug} needs an example`);
    assert.ok(['image', 'video'].includes(example.kind));
    assert.match(example.url, /^https:\/\/cdn\.lipsync\.video\//);
    assert.equal(example.sourceUrl, `https://lipsync.video/${item.slug === 'lip-sync' ? '' : item.slug}`);
    assert.equal(creativeFeatureExampleAssetPath(item.slug), example.url);
  }
});

test('reference media uses the fixed audited URL without leaking a referrer', async () => {
  const studio = await readFile(new URL('../app/veyrnox/_components/CreativeFeatureStudio.js', import.meta.url), 'utf8');
  assert.match(studio, /src=\{exampleAsset\}/);
  assert.doesNotMatch(studio, /src=\{example\.url\}/);
  assert.match(studio, /referrerPolicy="no-referrer"/);
});

test('the shared studio renders upload controls even for guarded workflows', async () => {
  const studio = await readFile(new URL('../app/veyrnox/_components/CreativeFeatureStudio.js', import.meta.url), 'utf8');
  assert.match(studio, /feature\.media\.length > 0 && <SourcePickers/);
  assert.doesNotMatch(studio, /feature\.media\.length && !feature\.blocked/);
  assert.match(studio, /data-testid="source-upload-script"/);
  assert.match(studio, /<p className="mt-2 text-sm font-black">\{copy\.title\}<\/p>/);
  assert.doesNotMatch(studio, />\{feature\.model\}<\/p>/);
});

test('voice cloning uses the live fal voice model and the shared audio upload flow', () => {
  const voice = creativeFeature('ai-voice-cloning');
  assert.equal(voice.model, 'zonos2-voice-clone');
  assert.deepEqual(voice.media, ['audio']);
  assert.equal(voice.blocked, undefined);
  assert.deepEqual(CREATIVE_FEATURES.filter((item) => item.blocked), []);
});

test('the app route and sidebar expose the workflow suite', async () => {
  const [page, detail, nav] = await Promise.all([
    readFile(new URL('../app/veyrnox/app/features/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/app/features/[slug]/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /creativeFeatureGroups/);
  assert.match(detail, /generateStaticParams/);
  assert.doesNotMatch(detail, /VoiceCloneStudio|MfaPanel/);
  assert.match(nav, /href: '\/app\/features'/);
  assert.match(nav, /key: 'features', href: '\/app\/features'/);
});
