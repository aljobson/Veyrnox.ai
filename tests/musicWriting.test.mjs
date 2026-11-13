import test from 'node:test';
import assert from 'node:assert/strict';
import {
  augmentMusicStyle,
  buildMusicLyricAssistantPrompt,
  buildMusicLyricSelectionPrompt,
  insertMusicStructureLabel,
  MUSIC_LYRIC_ASSISTANT_PROMPT_MAX,
  MUSIC_LYRIC_ASSISTANT_REQUEST_MAX,
  MUSIC_PROMPT_SUGGESTIONS,
  MUSIC_STRUCTURE_LABELS,
  MUSIC_STYLE_DETAILS,
  musicWritingReferences,
  nextMusicPrompt,
} from '../app/veyrnox/_components/music/musicWriting.js';

test('random-direction helper cycles through bounded original prompts', () => {
  assert.equal(MUSIC_PROMPT_SUGGESTIONS.length, 4);
  assert.equal(nextMusicPrompt(''), MUSIC_PROMPT_SUGGESTIONS[0]);
  assert.equal(nextMusicPrompt(MUSIC_PROMPT_SUGGESTIONS[0]), MUSIC_PROMPT_SUGGESTIONS[1]);
  assert.equal(nextMusicPrompt(MUSIC_PROMPT_SUGGESTIONS.at(-1)), MUSIC_PROMPT_SUGGESTIONS[0]);
  for (const prompt of MUSIC_PROMPT_SUGGESTIONS) assert.ok(prompt.length > 20 && prompt.length <= 500);
});

test('structure labels append safely without crossing the lyric boundary', () => {
  assert.deepEqual(MUSIC_STRUCTURE_LABELS, ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Instrumental]', '[Outro]']);
  assert.equal(insertMusicStructureLabel('', '[Verse]'), '[Verse]\n');
  assert.equal(insertMusicStructureLabel('[Verse]\nA line', '[Chorus]'), '[Verse]\nA line\n[Chorus]\n');
  assert.equal(insertMusicStructureLabel('unchanged', '[Unsafe]'), 'unchanged');
  assert.equal(insertMusicStructureLabel('x'.repeat(2999), '[Outro]'), 'x'.repeat(2999));
});

test('style augmentation adds one bounded original production detail at a time', () => {
  const first = augmentMusicStyle('Warm piano, 84 bpm');
  assert.equal(first, `Warm piano, 84 bpm; ${MUSIC_STYLE_DETAILS[0]}`);
  assert.equal(augmentMusicStyle(first), `${first}; ${MUSIC_STYLE_DETAILS[1]}`);
  assert.equal(augmentMusicStyle('x'.repeat(499)), 'x'.repeat(499));
  assert.ok(MUSIC_STYLE_DETAILS.every((item) => item.length > 20));
});

test('writing references use the selected word or caret context without rewriting lyrics', () => {
  const text = '[Verse]\nCafé lights over the harbour';
  const selected = musicWritingReferences(text, text.indexOf('lights'), text.indexOf('lights') + 6);
  assert.equal(selected.anchor, 'lights');
  assert.deepEqual(selected.rhymes, ['night', 'sight', 'height', 'bright']);
  const singular = musicWritingReferences('Hold the light', 14, 14);
  assert.equal(singular.anchor, 'light');
  assert.deepEqual(singular.rhymes, ['night', 'sight', 'height', 'bright']);
  assert.equal(singular.lineStarters.length, 3);
  assert.deepEqual(musicWritingReferences('', 0, 0), { anchor: '', rhymes: [], lineStarters: [] });
});

test('lyric assistant handoff builds one bounded original-writing request without sending it', () => {
  assert.equal(buildMusicLyricAssistantPrompt({ lyrics: 'a line', request: '   ' }), '');
  const prompt = buildMusicLyricAssistantPrompt({
    lyrics: '[Verse]\r\nHarbour lights'.repeat(250),
    request: 'Tighten the chorus but keep the harbour image.'.repeat(20),
  });
  assert.ok(prompt.length <= MUSIC_LYRIC_ASSISTANT_PROMPT_MAX);
  assert.match(prompt, /I wrote or own any draft/);
  assert.match(prompt, /Do not imitate a living artist/);
  assert.match(prompt, /BEGIN REVISED LYRICS\n\[revised lyrics only\]\nEND REVISED LYRICS/);
  assert.match(prompt, /Tighten the chorus but keep the harbour image/);
  assert.match(prompt, /BEGIN MY DRAFT\n\[Verse\]\nHarbour lights/);
  assert.equal(prompt.includes('\r'), false);
  const request = prompt.split('Editing request:\n')[1].split('\n\nRules:')[0];
  assert.equal(request.length, MUSIC_LYRIC_ASSISTANT_REQUEST_MAX);
});

test('selected-line handoff keeps the exact selection and response contract inside its bound', () => {
  const lyrics = '[Verse]\r\nKeep this line\r\nChange only this line\r\nKeep this ending';
  const normalized = lyrics.replace(/\r\n?/g, '\n');
  const start = normalized.indexOf('Change');
  const end = start + 'Change only this line'.length;
  assert.equal(buildMusicLyricSelectionPrompt({ lyrics, selectionStart: start, selectionEnd: start, request: 'Revise.' }), '');
  assert.equal(buildMusicLyricSelectionPrompt({ lyrics, selectionStart: start, selectionEnd: end, request: '   ' }), '');
  assert.equal(buildMusicLyricSelectionPrompt({ lyrics, selectionStart: 1.5, selectionEnd: end, request: 'Revise.' }), '');
  const prompt = buildMusicLyricSelectionPrompt({ lyrics, selectionStart: start, selectionEnd: end, request: 'Make it more vivid.' });
  assert.ok(prompt.length <= MUSIC_LYRIC_ASSISTANT_PROMPT_MAX);
  assert.match(prompt, /SELECTED RANGE\nChange only this line\nEND SELECTED RANGE/);
  assert.match(prompt, /DRAFT CONTEXT\n\[Verse\]\nKeep this line/);
  assert.match(prompt, /BEGIN REPLACEMENT LINES\n\[replacement lines only\]\nEND REPLACEMENT LINES$/);
  assert.equal(prompt.includes('\r'), false);

  const long = 'selected '.repeat(370);
  const bounded = buildMusicLyricSelectionPrompt({ lyrics: long, selectionStart: 0, selectionEnd: long.length, request: 'Tighten.' });
  assert.ok(bounded.length <= MUSIC_LYRIC_ASSISTANT_PROMPT_MAX);
  assert.match(bounded, /END REPLACEMENT LINES$/);
});
