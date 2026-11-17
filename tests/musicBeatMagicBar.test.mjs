import { englishBeatImports } from './helpers/musicBeatI18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { make } from './musicBeatFixtures.mjs';
import * as magic from '../app/veyrnox/_lib/music/beat/magicBar.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatMagicBar.jsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const compiled = { exports: {} };
const stubs = { ...englishBeatImports,
  '../../../_lib/gateway': { gatewayFetch: () => assert.fail('render must not make a request') },
  '../../../_lib/useMusicAudioSrc': { MusicPrivateAudio: () => null },
  '../../../_lib/music/beat/magicBar.mjs': magic,
  './beatStyles': { action: '', button: '', input: '' },
};
new Function('require', 'module', 'exports', code)(id => stubs[id] || require(id), compiled, compiled.exports);
const BeatMagicBar = compiled.exports.default;

test('AI generation hides the rendered legacy prompt form and keeps existing loop controls', () => {
  const loops = { layers: [{ songId: 'song', title: 'Existing keys', bars: 4, muted: false }], toggleMute() {}, remove() {} };
  const render = ai => renderToStaticMarkup(createElement(BeatMagicBar, { doc: make(), loops, announce() {}, hidePrompt: ai.generate }));
  assert.match(render({ generate: false }), /<form[ >]/);
  const html = render({ generate: true });
  assert.doesNotMatch(html, /<form[ >]|<textarea[ >]/);
  assert.match(html, /Existing keys/); assert.match(html, />Mute<\/button>/); assert.match(html, />Remove<\/button>/);
});
