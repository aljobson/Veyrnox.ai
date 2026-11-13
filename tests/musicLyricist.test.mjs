import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMusicLyricistProfile,
  isMusicLyricistProfile,
  musicLyricistLabel,
  MUSIC_LYRICIST_DIRECTION_MAX,
  MUSIC_LYRICIST_EXAMPLES_MAX,
  MUSIC_LYRICIST_INSTRUCTION_PREFIX,
  MUSIC_LYRICIST_NAME_MAX,
} from '../app/veyrnox/_components/music/musicLyricist.js';

test('private Lyricist profiles require owned examples and remain inside Chat instruction limits', () => {
  assert.equal(buildMusicLyricistProfile({ name: 'Harbour', direction: 'Sparse.', examples: 'Mine.' }), null);
  const profile = buildMusicLyricistProfile({
    name: 'N'.repeat(MUSIC_LYRICIST_NAME_MAX + 20),
    direction: 'd'.repeat(MUSIC_LYRICIST_DIRECTION_MAX + 20),
    examples: 'e'.repeat(MUSIC_LYRICIST_EXAMPLES_MAX + 20),
    ownsExamples: true,
  });
  assert.equal(profile.name, `Lyricist · ${'N'.repeat(MUSIC_LYRICIST_NAME_MAX)}`);
  assert.ok(profile.instructions.startsWith(MUSIC_LYRICIST_INSTRUCTION_PREFIX));
  assert.ok(profile.instructions.length <= 4000);
  assert.match(profile.instructions, /Never reproduce a distinctive line/);
  assert.deepEqual({ model_id: profile.model_id, thinking: profile.thinking, web: profile.web }, { model_id: null, thinking: false, web: false });
});

test('only explicitly tagged private personas appear as Music Lyricist profiles', () => {
  const persona = { id: '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f', name: 'Lyricist · Harbour', instructions: `${MUSIC_LYRICIST_INSTRUCTION_PREFIX}\nPrivate` };
  assert.equal(isMusicLyricistProfile(persona), true);
  assert.equal(musicLyricistLabel(persona), 'Harbour');
  assert.equal(isMusicLyricistProfile({ ...persona, name: 'Editor' }), false);
  assert.equal(isMusicLyricistProfile({ ...persona, instructions: 'Generic instructions' }), false);
});
