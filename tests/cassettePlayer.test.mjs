import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../app/veyrnox/_components/CassettePlayer.js', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'esm' });
const { CassettePlayer } = await import(`data:text/javascript,${encodeURIComponent(code.replace('"react/jsx-runtime"', `"${import.meta.resolve('react/jsx-runtime')}"`).replace('"react"', `"${import.meta.resolve('react')}"`))}`);

test('the cassette is decoration: hidden from assistive tech, with the native audio controls left in place', () => {
  const html = renderToStaticMarkup(React.createElement(CassettePlayer, { src: '/a.mp3', label: 'Result' }));
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.match(html, /<audio[^>]*controls/);
  assert.match(html, /<audio[^>]*aria-label="Result"/);
  assert.match(html, /data-playing="false"/);
});

test('the reels only turn while playing, and never under reduced motion', () => {
  const css = readFileSync(new URL('../app/veyrnox/veyrnox.css', import.meta.url), 'utf8');
  assert.match(css, /\.vx-reel \{[^}]*animation-play-state: paused/);
  assert.match(css, /\.vx-cassette\[data-playing='true'\] \.vx-reel \{ animation-play-state: running/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.vx-reel \{ animation: none/);
});

test('the audio result preview uses the cassette', () => {
  const preview = readFileSync(new URL('../app/veyrnox/_components/JobAssetPreview.js', import.meta.url), 'utf8');
  assert.match(preview, /<CassettePlayer src=\{asset\.url\}/);
  assert.doesNotMatch(preview, /<audio /);
});

test('a refused play is reported through onError, and only an interrupted one is ignored', () => {
  assert.match(source, /err\?\.name !== 'AbortError'\) onError\?\.\(\)/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/);
});

test('the audio preview grows with the player instead of being clipped by a fixed frame', () => {
  const preview = readFileSync(new URL('../app/veyrnox/_components/JobAssetPreview.js', import.meta.url), 'utf8');
  const audioBranch = preview.slice(preview.indexOf("startsWith('audio/')"), preview.indexOf('CassettePlayer src'));
  assert.doesNotMatch(audioBranch, /absolute inset-0/);
});

test('a track that autoplayed before hydration still turns the reels', () => {
  assert.match(source, /useEffect\(\(\) => \{ if \(audio\.current && !audio\.current\.paused\) setPlaying\(true\)/);
});
