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

test('voice cloning is the only guarded workflow and names the remaining production gate', () => {
  const blocked = CREATIVE_FEATURES.filter((item) => item.blocked);
  assert.deepEqual(blocked.map((item) => item.slug), ['ai-voice-cloning']);
  assert.match(blocked[0].blockedReason, /verification.*two-factor.*revocation.*provider account/i);
});

test('the app route and sidebar expose the workflow suite', async () => {
  const [page, detail, nav] = await Promise.all([
    readFile(new URL('../app/veyrnox/app/features/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/app/features/[slug]/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /creativeFeatureGroups/);
  assert.match(detail, /generateStaticParams/);
  assert.match(nav, /href: '\/app\/features'/);
  assert.match(nav, /key: 'features', href: '\/app\/features'/);
});
