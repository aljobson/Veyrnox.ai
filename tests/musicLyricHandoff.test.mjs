import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearMusicLyricHandoff,
  MUSIC_LYRIC_END,
  MUSIC_LYRIC_HANDOFF_KEY,
  MUSIC_LYRIC_START,
  MUSIC_REPLACEMENT_END,
  MUSIC_REPLACEMENT_START,
  parseMusicLyricAssistantReply,
  parseMusicLyricReplacementReply,
  readMusicLyricHandoff,
  replaceMusicLyricSelection,
  writeMusicLyricHandoff,
  writeMusicLyricProposal,
} from '../app/veyrnox/_components/music/musicLyricHandoff.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = 1_800_000_000_000;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('assistant replies import only one complete bounded lyric block', () => {
  const reply = `A note outside is ignored.\n${MUSIC_LYRIC_START}\r\n[Verse]\r\nHarbour light\r\n${MUSIC_LYRIC_END}\nAnother note`;
  assert.equal(parseMusicLyricAssistantReply(reply), '[Verse]\nHarbour light');
  assert.equal(parseMusicLyricAssistantReply('Harbour light'), '');
  assert.equal(parseMusicLyricAssistantReply(`${MUSIC_LYRIC_START}\n\n${MUSIC_LYRIC_END}`), '');
  assert.equal(parseMusicLyricAssistantReply(`${MUSIC_LYRIC_START}\n${'x'.repeat(3001)}\n${MUSIC_LYRIC_END}`), '');
});

test('selected-line replies require one complete bounded replacement block', () => {
  const reply = `Outside notes are ignored.\n${MUSIC_REPLACEMENT_START}\r\nNew first line\r\nNew second line\r\n${MUSIC_REPLACEMENT_END}\nMore notes`;
  assert.equal(parseMusicLyricReplacementReply(reply), 'New first line\nNew second line');
  assert.equal(parseMusicLyricReplacementReply('New first line'), '');
  assert.equal(parseMusicLyricReplacementReply(`${MUSIC_REPLACEMENT_START}\n\n${MUSIC_REPLACEMENT_END}`), '');
  assert.equal(parseMusicLyricReplacementReply(`${MUSIC_REPLACEMENT_START}\n${'x'.repeat(3001)}\n${MUSIC_REPLACEMENT_END}`), '');
});

test('selected-line replacement preserves every byte outside the captured range', () => {
  const source = '[Verse]\nKeep this\nChange this line\nKeep this too';
  const start = source.indexOf('Change');
  const end = start + 'Change this line'.length;
  assert.equal(replaceMusicLyricSelection(source, start, end, 'A brighter line'), '[Verse]\nKeep this\nA brighter line\nKeep this too');
  assert.equal(replaceMusicLyricSelection(source, -1, end, 'Nope'), '');
  assert.equal(replaceMusicLyricSelection(source, start, start, 'Nope'), '');
  assert.equal(replaceMusicLyricSelection(source, start, end, ''), '');
  assert.equal(replaceMusicLyricSelection(source, start, end, 'x'.repeat(3000)), '');
});

test('handoff context is account-bound, short-lived and exact', () => {
  const storage = memoryStorage();
  assert.equal(writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 4, sourceLyrics: '[Verse]\nMine', request: 'Tighten it.' }, NOW), true);
  assert.deepEqual(readMusicLyricHandoff(storage, USER, NOW), {
    v: 1, user_id: USER, source_revision: 4, source_lyrics: '[Verse]\nMine', request: 'Tighten it.', created_at: NOW,
  });
  assert.equal(readMusicLyricHandoff(storage, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NOW), null);
  assert.equal(readMusicLyricHandoff(storage, USER, NOW + 60 * 60 * 1000 + 1), null);
});

test('a handoff may bind one exact private Chat persona id', () => {
  const storage = memoryStorage();
  const profileId = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
  assert.equal(writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 1, sourceLyrics: 'Mine', request: 'Revise.', profileId }, NOW), true);
  assert.equal(readMusicLyricHandoff(storage, USER, NOW).profile_id, profileId);
  assert.equal(writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 1, sourceLyrics: 'Mine', request: 'Revise.', profileId: 'not-a-persona' }, NOW), false);
});

test('a selected-line handoff binds exact valid source offsets', () => {
  const storage = memoryStorage();
  const sourceLyrics = '[Verse]\nFirst line\nSecond line';
  const selection = { start: sourceLyrics.indexOf('First'), end: sourceLyrics.indexOf('Second') - 1 };
  assert.equal(writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 2, sourceLyrics, request: 'Make this vivid.', selection }, NOW), true);
  assert.deepEqual(readMusicLyricHandoff(storage, USER, NOW), {
    v: 1, user_id: USER, source_revision: 2, source_lyrics: sourceLyrics, request: 'Make this vivid.', created_at: NOW,
    mode: 'selection', selection_start: selection.start, selection_end: selection.end,
  });
  assert.equal(writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 2, sourceLyrics, request: 'Revise.', selection: { start: 2, end: 99 } }, NOW), false);
});

test('a proposal is stored only after exact parsing and can be discarded', () => {
  const storage = memoryStorage();
  writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 1, sourceLyrics: 'Old line', request: 'Revise it.' }, NOW);
  assert.equal(writeMusicLyricProposal(storage, USER, 'No markers', NOW), false);
  assert.equal(writeMusicLyricProposal(storage, USER, `${MUSIC_LYRIC_START}\nNew line\n${MUSIC_LYRIC_END}`, NOW), true);
  assert.equal(readMusicLyricHandoff(storage, USER, NOW).proposal, 'New line');
  clearMusicLyricHandoff(storage);
  assert.equal(storage.getItem(MUSIC_LYRIC_HANDOFF_KEY), null);
});

test('a selected-line handoff accepts only replacement markers', () => {
  const storage = memoryStorage();
  writeMusicLyricHandoff(storage, { userId: USER, sourceRevision: 1, sourceLyrics: 'Old line', request: 'Revise it.', selection: { start: 0, end: 8 } }, NOW);
  assert.equal(writeMusicLyricProposal(storage, USER, `${MUSIC_LYRIC_START}\nWrong marker\n${MUSIC_LYRIC_END}`, NOW), false);
  assert.equal(writeMusicLyricProposal(storage, USER, `${MUSIC_REPLACEMENT_START}\nNew line\n${MUSIC_REPLACEMENT_END}`, NOW), true);
  assert.equal(readMusicLyricHandoff(storage, USER, NOW).proposal, 'New line');
});
