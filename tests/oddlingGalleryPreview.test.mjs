import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import { ODDLING_PUPPET_RIGS, puppetRig, puppetPose } from '../app/veyrnox/_lib/oddlingPuppetRigs.js';
import { preparePuppetPixels, PUPPET_FRAGMENT_SHADER } from '../app/veyrnox/_lib/oddlingPuppetRenderer.js';

const read = (file) => readFileSync(new URL(`../app/veyrnox/_components/${file}`, import.meta.url), 'utf8');
const preview = read('OddlingGalleryPreview.js');
const css = read('OddlingGalleryPreview.module.css');
// The studio and the pieces split out of it (Explore, its filters, the portrait).
const studio = ['OddlingStudio.js', 'OddlingExplore.js', 'OddlingExploreFilters.js', 'OddlingPortrait.js'].map(file => resolveI18nSource(read(file))).join('\n');

test('gallery loops are presentation-only and never submit or upload a generation', () => {
  assert.doesNotMatch(preview, /fetch\s*\(|gatewayFetch|\/generations|\/uploads|onAnimate|router\.push/);
  assert.match(studio, /previewsPlaying=\{previewsPlaying && motionAllowed\}/);
  assert.match(studio, /Free dancing puppet previews/);
  assert.match(studio, /no generation or credits/);
  const renderer = readFileSync(new URL('../app/veyrnox/_lib/oddlingPuppetRenderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(renderer, /fetch\s*\(|gatewayFetch|\/generations|\/uploads/);
});

test('local reference preview rejects active image formats', () => {
  assert.match(studio, /\['image\/jpeg', 'image\/png', 'image\/webp', 'image\/avif'\]\.includes\(file\.type\)/);
  assert.doesNotMatch(studio, /file\.type\.startsWith\('image\/'\)/);
});

test('loops pause off-screen, in hidden tabs, on user request and for reduced motion', () => {
  assert.match(preview, /IntersectionObserver/);
  assert.match(preview, /observer\.disconnect\(\)/);
  assert.match(preview, /!document\.hidden/);
  assert.match(preview, /prefers-reduced-motion: reduce/);
  assert.match(preview, /playing && visible/);
  assert.match(preview, /cancelAnimationFrame\(animation\)/);
  assert.match(preview, /renderer\?\.destroy\(\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*display: none/);
  assert.match(studio, /aria-pressed=\{previewsPlaying\}/);
  assert.match(studio, /["']Pause dancing["'] : ["']Play dancing["']/);
});

test('motion never zooms beyond the full portrait and leaves the source untouched', () => {
  assert.doesNotMatch(css, /scale\(1[.\d]*\)/);
  assert.doesNotMatch(css, /@keyframes|transform:/);
  assert.match(studio, /<CharacterPortrait oddling=\{oddling\} \/>/);
});

test('all originals have bounded head, eye, chest, arm and lower-body calibration', () => {
  assert.deepEqual(Object.keys(ODDLING_PUPPET_RIGS).sort(), ODDLING_ARCHETYPES.map(({ id }) => id).sort());
  assert.equal(puppetRig('__proto__'), null);
  assert.equal(puppetRig('../../somewhere'), null);
  for (const [id, rig] of Object.entries(ODDLING_PUPPET_RIGS)) {
    assert.ok(rig.head.length >= 10, id);
    for (const [x, y] of [...rig.head, rig.pivot, ...rig.eyes]) {
      assert.ok(x > 0 && x < 1024 && y > 0 && y < 1536, id);
    }
    assert.equal(rig.eyes.length, 2);
    rig.eyes.forEach(([, , rx, ry]) => assert.ok(rx > 0 && ry > 0, id));
    assert.ok(rig.chest[2] > 0 && rig.chest[3] > 0, id);
    assert.equal(rig.arms.length, 2, id);
    rig.arms.forEach(([x, y, rx, ry]) => {
      assert.ok(x > 0 && x < 1024 && y > 0 && y < 1536, id);
      assert.ok(rx > 0 && ry > 0, id);
    });
    assert.ok(rig.lower[0] > 0 && rig.lower[0] < 1024 && rig.lower[1] > 0 && rig.lower[1] < 1536, id);
    assert.ok(rig.lower[2] > 0 && rig.lower[3] > 0, id);
    assert.ok(rig.tilt > 0 && rig.tilt <= 0.012, id);
    assert.equal(typeof rig.shutter, 'boolean');
  }
});

test('every rig blinks, breathes, moves its head, sways its arms and takes in-place steps', () => {
  for (const id of Object.keys(ODDLING_PUPPET_RIGS)) {
    assert.deepEqual(puppetPose(0, id), {
      blink: 0, breath: 0, angle: 0, nod: 0,
      armSwing: 0, weightShift: 0, step: 0, torsoSway: 0,
    });
    const poses = Array.from({ length: 1200 }, (_, index) => puppetPose(index / 120, id));
    for (const feature of ['blink', 'breath', 'angle', 'nod', 'armSwing', 'weightShift', 'step', 'torsoSway']) {
      assert.ok(poses.some((pose) => Math.abs(pose[feature]) > (feature === 'blink' ? 0.97 : 0.001)), `${id}: ${feature}`);
    }
    assert.ok(poses.every(({ blink, breath, angle, nod, armSwing, weightShift, step, torsoSway }) => blink >= 0 && blink <= 1
      && Math.abs(breath) <= 0.026 && Math.abs(angle) <= puppetRig(id).tilt && Math.abs(nod) <= 4.4
      && [armSwing, weightShift, step, torsoSway].every((value) => Math.abs(value) <= 1)));
    assert.deepEqual(puppetPose(NaN, id), puppetPose(0, id));
  }
});

test('stationary plate retains every pixel outside the head matte and never edits the source', () => {
  const width = 64, height = 96;
  const data = new Uint8ClampedArray(width * height * 4);
  const polygon = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data.set([30, 40, 50, 255], i);
    if (x >= 22 && x <= 42 && y >= 12 && y <= 38) { data.set([170, 140, 120, 255], i); polygon[i + 3] = 255; }
  }
  const original = data.slice();
  const result = preparePuppetPixels({ width, height, data }, polygon,
    { head: [[20, 10], [44, 10], [44, 40], [20, 40]], eyes: [[27, 20, 2, 1], [37, 20, 2, 1]], shutter: false });
  assert.deepEqual(data, original);
  for (let i = 0; i < data.length; i += 4) {
    if (!polygon[i + 3]) {
      assert.deepEqual(result.plate.slice(i, i + 4), new Uint8Array(data.slice(i, i + 4)));
      assert.equal(result.head[i + 3], 0);
    } else {
      assert.deepEqual(result.plate.slice(i, i + 3), new Uint8Array([30, 40, 50]));
      assert.equal(result.head[i + 3], 255);
    }
  }
  assert.match(PUPPET_FRAGMENT_SHADER, /max\(0\.0, 1\.0 - dot\(localChest, localChest\)\)/);
  assert.match(PUPPET_FRAGMENT_SHADER, /armWeight0/);
  assert.match(PUPPET_FRAGMENT_SHADER, /lowerWeight/);
  assert.match(PUPPET_FRAGMENT_SHADER, /pose2\.x \* 26\.0/);
  assert.match(PUPPET_FRAGMENT_SHADER, /pose2\.y \* 14\.0/);
});
