import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { musicBeatEditorEnabled, musicStudioChatEnabled } from '../lib/musicBackend.js';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('beat editor defaults off, supports JSON and legacy overrides, and requires UI', () => {
  assert.equal(musicBeatEditorEnabled({}), false);
  assert.equal(musicBeatEditorEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true}' }), true);
  assert.equal(musicBeatEditorEnabled({ MUSIC_UI_ENABLED: 'true', MUSIC_BEAT_EDITOR_ENABLED: 'true' }), true);
  assert.equal(musicBeatEditorEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true}', MUSIC_BEAT_EDITOR_ENABLED: 'false' }), false);
  assert.equal(musicBeatEditorEnabled({ MUSIC_RUNTIME_FLAGS: '{"beatEditor":true}' }), false);
  assert.equal(musicBeatEditorEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true}', MUSIC_UI_ENABLED: 'false' }), false);
});
test('Studio actions remain hidden unless UI, beat editor and studioChat are all enabled', () => {
  assert.equal(musicStudioChatEnabled({}), false);
  assert.equal(musicStudioChatEnabled({ MUSIC_RUNTIME_FLAGS: '{"studioChat":true}' }), false);
  assert.equal(musicStudioChatEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"studioChat":true}' }), false);
  assert.equal(musicStudioChatEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true}' }), false);
  assert.equal(musicStudioChatEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true,"studioChat":true}' }), true);
  const page = read('app/veyrnox/app/music/beats/[id]/page.js');
  assert.match(page, /studioChat=\{musicStudioChatEnabled\(\)\}/);
});
test('both server pages gate before loading browser-only editor code', () => {
  for (const [path, loader] of [['page.js', 'BeatsHomeLoader'], ['[id]/page.js', 'BeatEditorLoader']]) {
    const page = read(`app/veyrnox/app/music/beats/${path}`);
    assert.match(page, /if \(!musicBeatEditorEnabled\(\)\) notFound\(\)/);
    assert.ok(page.indexOf('notFound();') < page.indexOf(`return <${loader}`));
    assert.doesNotMatch(page, /beatEngine|beatStore|beatDocument|instrumentEngine/);
    const source = read(`app/veyrnox/_components/music/beat/${loader}.jsx`);
    assert.match(source, /^'use client'/); assert.match(source, /dynamic\(\(\) => import\(/); assert.match(source, /ssr: false/);
  }
  assert.match(read('app/veyrnox/_components/music/MusicPreviewShell.jsx'), /if \(link.beats\) return beatsMode/);
  assert.match(read('app/veyrnox/app/music/layout.js'), /beatsMode=\{beatsMode\}/);
});
