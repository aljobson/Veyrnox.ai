import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../app/veyrnox/_components/${file}`, import.meta.url), 'utf8');
const preview = read('OddlingGalleryPreview.js');
const css = read('OddlingGalleryPreview.module.css');
const studio = read('OddlingStudio.js');

test('gallery loops are presentation-only and never submit or upload a generation', () => {
  assert.doesNotMatch(preview, /fetch\s*\(|gatewayFetch|\/generations|\/uploads|onAnimate|router\.push/);
  assert.match(studio, /previewsPlaying=\{previewsPlaying && motionAllowed\}/);
  assert.match(studio, /Free photo-motion previews · no generation or credits/);
});

test('loops pause off-screen, in hidden tabs, on user request and for reduced motion', () => {
  assert.match(preview, /IntersectionObserver/);
  assert.match(preview, /observer\.disconnect\(\)/);
  assert.match(preview, /!document\.hidden/);
  assert.match(preview, /prefers-reduced-motion: reduce/);
  assert.match(preview, /playing && visible/);
  assert.match(css, /animation-play-state: paused/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none; transform: none/);
  assert.match(studio, /aria-pressed=\{previewsPlaying\}/);
  assert.match(studio, /'Pause previews' : 'Play previews'/);
});

test('motion never zooms beyond the full portrait and leaves the source untouched', () => {
  assert.doesNotMatch(css, /scale\(1[.\d]*\)/);
  assert.match(css, /scale\(0\.94\)/);
  assert.match(studio, /<CharacterPortrait oddling=\{oddling\} \/>/);
});
