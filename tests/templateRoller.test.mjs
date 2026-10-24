import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the public catalog contains only templates with unique local videos', () => {
  const videos = new Set();
  for (const preset of PRESETS) {
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
});

test('the roller keeps the existing full card layouts', () => {
  const gallery = read('app/veyrnox/_components/PresetGallery.js');
  const landing = read('app/veyrnox/_sections/showcase.js');
  const mobile = read('app/veyrnox/m/explore/page.js');
  assert.match(gallery, /<TemplateRoller[\s\S]*id="preset-gallery-results"/);
  assert.match(landing, /<TemplateRoller[\s\S]*<MediaTile/);
  assert.match(mobile, /<TemplateRoller[\s\S]*<PresetCard/);
});
