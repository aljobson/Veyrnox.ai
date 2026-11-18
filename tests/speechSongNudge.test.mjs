import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { looksLikeSong, showSpeechSongNudge, MUSIC_STUDIO_HREF } from '../app/veyrnox/_lib/speechSongNudge.mjs';
import * as nudge from '../app/veyrnox/_lib/speechSongNudge.mjs';
import messages from '../lib/i18n/messages/app/en.mjs';
import { translator } from '../lib/i18n/translate.mjs';

const require = createRequire(import.meta.url);
const speech = { id: 'inworld-tts', isSpeech: true, kind: 'audio' };
const music = { id: 'ace-step', isSpeech: false, kind: 'audio' };

test('song-like prompts are recognised, ordinary scripts are not', () => {
  for (const text of ['Happy Birthday song for a 5 year old', 'write lyrics about the sea', '[Verse 1]\nHello', 'a lullaby for my son', 'Sing this', 'catchy JINGLE for my shop']) {
    assert.equal(looksLikeSong(text), true, text);
  }
  for (const text of ['Welcome to our store. Open daily from nine.', 'Press one for sales, two for support.', 'The crowd sung along', '', '   ', null, undefined]) {
    assert.equal(looksLikeSong(text), text === 'The crowd sung along', String(text));
  }
});

test('words that merely contain a song word do not match', () => {
  for (const text of ['Our songwriter team', 'a versed professional', 'the rapport we built', 'singular offer']) assert.equal(looksLikeSong(text), false, text);
});

test('the hint shows only for a speech model', () => {
  assert.equal(showSpeechSongNudge(speech, 'Happy Birthday song'), true);
  assert.equal(showSpeechSongNudge(music, 'Happy Birthday song'), false);
  assert.equal(showSpeechSongNudge(null, 'Happy Birthday song'), false);
  assert.equal(showSpeechSongNudge(speech, 'Welcome to the store'), false);
});

const source = readFileSync(new URL('../app/veyrnox/_components/SpeechSongNudge.js', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const english = translator('en', messages);
const stubs = {
  'next/link': { __esModule: true, default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children) },
  '../../../components/I18nProvider': { useI18n: () => ({ locale: 'en', t: english }) },
  '../_lib/speechSongNudge.mjs': nudge,
};
const compiled = { exports: {} };
new Function('require', 'module', 'exports', code)((id) => stubs[id] || require(id), compiled, compiled.exports);
const { SpeechSongNudge } = compiled.exports;

test('the note names the problem and links to the Music studio', () => {
  const html = renderToStaticMarkup(createElement(SpeechSongNudge, { model: speech, prompt: 'Happy Birthday song' }));
  assert.match(html, /role="note"/);
  assert.match(html, /reads your text aloud/);
  assert.match(html, new RegExp(`href="${MUSIC_STUDIO_HREF}"`));
});

test('nothing renders for a music model or a plain script', () => {
  assert.equal(renderToStaticMarkup(createElement(SpeechSongNudge, { model: music, prompt: 'Happy Birthday song' })), '');
  assert.equal(renderToStaticMarkup(createElement(SpeechSongNudge, { model: speech, prompt: 'Welcome to the store' })), '');
});

test('both strings exist in every locale', async () => {
  for (const locale of ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const { default: hub } = await import(`../lib/i18n/messages/app/${locale}/audio-hub.mjs`);
    for (const key of ['app.audio.songNudge.text', 'app.audio.songNudge.action']) assert.ok(String(hub[key] || '').trim(), `${locale} ${key}`);
  }
});
