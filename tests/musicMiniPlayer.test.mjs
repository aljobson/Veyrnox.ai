import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { cleanTrack, idlePlayer, playerReducer } from '../app/veyrnox/_lib/music/miniPlayer.mjs';
import * as rules from '../app/veyrnox/_lib/music/miniPlayer.mjs';
import messages from '../lib/i18n/messages/app/en.mjs';
import { translator } from '../lib/i18n/translate.mjs';

const ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
const good = { id: ID, title: '  Harbour   Frame ', audioUrl: `/api/v1/jobs/${ID}/asset` };

test('a private song or an https address is a playable track, with a tidy title', () => {
  assert.deepEqual(cleanTrack(good), { id: ID, title: 'Harbour Frame', audioUrl: `/api/v1/jobs/${ID}/asset` });
  assert.ok(cleanTrack({ ...good, audioUrl: 'https://cdn.example.test/a.mp3' }));
  assert.ok(cleanTrack({ ...good, audioUrl: `/api/v1/jobs/${ID}/asset#t=1.5,9` }));
});

test('anything else is refused', () => {
  for (const bad of [null, undefined, 'x', {}, { ...good, id: '' }, { ...good, id: 'a b' }, { ...good, title: '   ' },
    { ...good, audioUrl: 'javascript:alert(1)' }, { ...good, audioUrl: 'http://insecure.test/a.mp3' }, { ...good, audioUrl: '/api/v1/other' },
    { ...good, audioUrl: `https://x.test/${'a'.repeat(2100)}` }, { ...good, audioUrl: 5 }]) {
    assert.equal(cleanTrack(bad), null, JSON.stringify(bad));
  }
  assert.equal(cleanTrack({ ...good, title: 'x'.repeat(300) }).title.length, 120);
});

test('play starts a track, a new play replaces it, close clears it', () => {
  const first = playerReducer(idlePlayer, { type: 'play', track: good });
  assert.deepEqual([first.track.id, first.playing], [ID, true]);
  const other = { id: 'second-song', title: 'Two', audioUrl: 'https://x.test/b.mp3' };
  assert.equal(playerReducer(first, { type: 'play', track: other }).track.id, 'second-song');
  assert.deepEqual(playerReducer(first, { type: 'close' }), idlePlayer);
});

test('a bad play, an unknown action and a playing change with no track leave the state alone', () => {
  const state = playerReducer(idlePlayer, { type: 'play', track: good });
  assert.equal(playerReducer(state, { type: 'play', track: { id: 'x' } }), state);
  assert.equal(playerReducer(state, { type: 'nope' }), state);
  assert.equal(playerReducer(state, undefined), state);
  assert.equal(playerReducer(idlePlayer, { type: 'playing', value: true }), idlePlayer);
  assert.equal(playerReducer(idlePlayer, { type: 'close' }), idlePlayer);
});

test('pause and resume only change the playing flag', () => {
  const state = playerReducer(idlePlayer, { type: 'play', track: good });
  const paused = playerReducer(state, { type: 'playing', value: false });
  assert.equal(paused.playing, false); assert.equal(paused.track, state.track);
  assert.equal(playerReducer(paused, { type: 'playing', value: false }), paused);
});

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicMiniPlayer.jsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const english = translator('en', messages);
const stubs = {
  '../../../../components/I18nProvider': { useI18n: () => ({ locale: 'en', t: english }) },
  '../../_lib/useMusicAudioSrc': { MusicPrivateAudio: () => null },
  '../../_lib/music/miniPlayer.mjs': rules,
};
const compiled = { exports: {} };
new Function('require', 'module', 'exports', code)((id) => stubs[id] || require(id), compiled, compiled.exports);
const { MusicPlayerProvider, PlayInBarButton } = compiled.exports;
const song = { id: ID, title: 'Harbour Frame', audio_url: `/api/v1/jobs/${ID}/asset` };

test('the button stays hidden outside the Music layout and shows inside it', () => {
  assert.equal(renderToStaticMarkup(createElement(PlayInBarButton, { song })), '');
  const html = renderToStaticMarkup(createElement(MusicPlayerProvider, null, createElement(PlayInBarButton, { song })));
  assert.match(html, /Keep playing while I browse/);
  assert.doesNotMatch(html, /music-mini-player/);
});

test('a song with no audio gets no button', () => {
  const html = renderToStaticMarkup(createElement(MusicPlayerProvider, null, createElement(PlayInBarButton, { song: { ...song, audio_url: null } })));
  assert.doesNotMatch(html, /Keep playing/);
});

test('all six strings exist in every locale and the title placeholder survives', async () => {
  for (const locale of ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const { default: polish } = await import(`../lib/i18n/messages/app/${locale}/music-beat-polish.mjs`);
    for (const key of ['playerLabel', 'playerKeep', 'playerNow', 'playerPlay', 'playerPause', 'playerClose']) {
      assert.ok(String(polish[`app.music.beat.shell.${key}`] || '').trim(), `${locale} ${key}`);
    }
    assert.match(polish['app.music.beat.shell.playerNow'], /\{title\}/, locale);
  }
});
