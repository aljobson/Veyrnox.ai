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

// No DOM library is installed, so drive the component through a minimal hook harness: the audio element
// is a stub whose `paused` we set before the mount effect runs, and we read the rendered data-playing.
async function mountWith(paused) {
  const hooks = { states: [], refs: [], effects: [], s: 0, r: 0, dirty: false };
  globalThis.__cassetteHooks = hooks;
  const fake = `export const useRef = (i) => { const h = globalThis.__cassetteHooks; return h.refs[h.r++] ??= { current: i }; };
    export const useState = (i) => { const h = globalThis.__cassetteHooks; const n = h.s++; if (!(n in h.states)) h.states[n] = i; return [h.states[n], (v) => { h.states[n] = v; h.dirty = true; }]; };
    export const useEffect = (fn) => { globalThis.__cassetteHooks.effects.push(fn); };`;
  const fakeUrl = `data:text/javascript,${encodeURIComponent(fake)}`;
  const mod = await import(`data:text/javascript,${encodeURIComponent(code.replace('"react/jsx-runtime"', `"${import.meta.resolve('react/jsx-runtime')}"`).replace('"react"', `"${fakeUrl}"`) + `\n// ${paused}`)}`);
  const render = () => { hooks.s = 0; hooks.r = 0; hooks.effects = []; return mod.CassettePlayer({ src: '/a.mp3' }); };
  render();
  hooks.refs[0].current = { paused }; // the browser attached the element, already playing or not
  hooks.dirty = false;
  hooks.effects.forEach((fn) => fn());
  return render().props['data-playing'];
}

test('a track that autoplayed before hydration turns the reels', async () => {
  assert.equal(await mountWith(false), true);
});

test('a paused track keeps the reels still', async () => {
  assert.equal(await mountWith(true), false);
});
