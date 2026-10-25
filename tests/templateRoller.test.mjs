import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PRESETS, hasTemplateVideo } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('gallery video eligibility excludes recipes with missing previews', () => {
  assert.equal(PRESETS.filter(hasTemplateVideo).length, 150);
  assert.equal(hasTemplateVideo({}), false);
  assert.equal(hasTemplateVideo({ clipKey: 'missing-preview' }), false);
  assert.equal(hasTemplateVideo(PRESETS.find((preset) => preset.clipKey)), true);
  for (const path of ['app/veyrnox/_components/PresetGallery.js', 'app/veyrnox/m/explore/page.js']) {
    assert.match(read(path), /\.filter\(hasTemplateVideo\)/, path);
  }
});

test('preview-backed templates contain unique local videos', () => {
  const videos = new Set();
  const previewBacked = PRESETS.filter((preset) => preset.clipKey);
  assert.equal(previewBacked.length, 150);
  for (const preset of previewBacked) {
    const clip = SHOWCASE_CLIPS[preset.clipKey];
    assert.ok(clip?.video, preset.id);
    assert.ok(existsSync(new URL(`../public${clip.video}`, import.meta.url)), preset.id);
    assert.ok(!videos.has(clip.video), `${preset.id} repeats ${clip.video}`);
    videos.add(clip.video);
  }
});

test('the collage roller supplements every template browsing surface', () => {
  const roller = read('app/veyrnox/_components/TemplateRoller.js');
  assert.match(roller, /data-testid="template-roller"/);
  assert.match(roller, /grid-flow-col-dense/);
  assert.match(roller, /variant="roller"/);
  assert.match(roller, /scrollBy/);

  for (const path of [
    'app/veyrnox/_components/PresetGallery.js',
    'app/veyrnox/_sections/showcase.js',
    'app/veyrnox/m/explore/page.js',
  ]) {
    assert.match(read(path), /<TemplateRoller\b/, path);
  }

  const gallery = read('app/veyrnox/_components/PresetGallery.js');
  const mobile = read('app/veyrnox/m/explore/page.js');
  assert.match(gallery, /ordered\.filter\(\(preset\) => preset\.clipKey\)\.slice\(0, 48\)/);
  assert.match(gallery, /<TemplateRoller presets=\{rollerPresets\}/);
  assert.match(mobile, /list\.filter\(\(preset\) => preset\.clipKey\)\.slice\(0, 48\)/);
  assert.match(mobile, /<TemplateRoller presets=\{rollerPresets\}/);
});

test('the roller keeps the existing full card layouts', () => {
  const gallery = read('app/veyrnox/_components/PresetGallery.js');
  const landing = read('app/veyrnox/_sections/showcase.js');
  const mobile = read('app/veyrnox/m/explore/page.js');
  assert.match(gallery, /<TemplateRoller[\s\S]*id="preset-gallery-results"/);
  assert.match(landing, /<TemplateRoller[\s\S]*<MediaTile/);
  assert.match(mobile, /<TemplateRoller[\s\S]*<PresetCard/);
});
