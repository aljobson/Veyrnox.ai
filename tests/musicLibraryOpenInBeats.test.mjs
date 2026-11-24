import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The song page already offers "Open in Beats"; the library list hardcoded its actions and never did.
test('the library page tells the list whether the Beats editor is on', () => {
  const page = read('app/veyrnox/app/music/library/page.js');
  assert.match(page, /musicBeatEditorEnabled/, 'the flag is imported');
  assert.match(page, /<MusicServerLibrary[^>]*beatEditor=\{musicBeatEditorEnabled\(\)\}/, 'and passed to the list');
});

test('each library row offers Open in Beats only when the editor is on', () => {
  const list = read('app/veyrnox/_components/music/MusicServerLibrary.jsx');
  assert.match(list, /export function MusicServerLibrary\(\{[^)]*beatEditor = false/, 'the list takes beatEditor, off by default');
  assert.match(list, /<ServerSongRow[^>]*beatEditor=\{beatEditor\}/, 'and hands it to every song row');
  assert.match(list, /function ServerSongRow\(\{[^)]*beatEditor = false/, 'the row takes it');
  assert.match(list, /<MusicSongActions[^>]*beatEditor=\{beatEditor\}[^>]*actions=\{beatEditor \? \[[^\]]*'open_studio'[^\]]*\] : \[[^\]]*\]\}/,
    'the menu gets open_studio and the flag together');
  assert.doesNotMatch(list, /actions=\{\['view_lineage', 'open_editor', 'organize'\]\}/, 'the old hardcoded list is gone');
});
