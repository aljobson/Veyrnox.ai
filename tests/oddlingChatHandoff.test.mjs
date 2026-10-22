import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_GROUPS, ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import {
  ODDLING_CHAT_HANDOFF_KEY,
  ODDLING_CHAT_HANDOFF_MAX_AGE,
  ODDLING_CHAT_THREAD_MAX_AGE,
  ODDLING_CANON_MAX,
  bindOddlingThreadContext,
  canFinishOddlingLaunch,
  makeOddlingChatLaunchId,
  oddlingCanonInstructions,
  oddlingHandoffName,
  readOddlingChatHandoff,
  readMatchingOddlingThreadContext,
  readOddlingThreadContext,
  removeOddlingChatHandoff,
  removeOddlingThreadContext,
  writeOddlingThreadContext,
  writeOddlingChatHandoff,
} from '../app/veyrnox/_lib/oddlingChatHandoff.js';

const NOW = 2_000_000;
const LAUNCH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LAUNCH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const USER_A = 'user-a';
const USER_B = 'user-b';
const LOCKED_PROMPT = 'Locked Oddling system prompt\nwith exact canon';
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('Oddling Chat handoff keeps a sanitized passport behind an opaque exact-match launch id', () => {
  const storage = memory();
  const picks = { ...ODDLING_ARCHETYPES[0].picks, unknown: 'drop me' };
  assert.equal(writeOddlingChatHandoff(storage, {
    ownerId: USER_A, picks, mode: 'motion', scene: '  A recurring kitchen\nset  ', referenceNote: 'keep the amber palette', portraitId: 'mossbyte', motionId: 'micro-dance',
  }, NOW, LAUNCH_A), LAUNCH_A);
  assert.equal(readOddlingChatHandoff(storage, LAUNCH_B, USER_A, NOW + 1000), null, 'another launch cannot take the latest passport');
  assert.equal(readOddlingChatHandoff(storage, LAUNCH_A, USER_B, NOW + 1000), null, 'another account cannot take the passport');
  const value = readOddlingChatHandoff(storage, LAUNCH_A, USER_A, NOW + 1000);
  assert.equal(value.mode, 'motion');
  assert.equal(value.scene, 'A recurring kitchen set');
  assert.equal(value.picks.unknown, undefined);
  assert.equal(value.portraitId, 'mossbyte');
  assert.equal(value.motionId, 'micro-dance');
  assert.equal(oddlingHandoffName(value), value.picks.oddling_name);
  const instructions = oddlingCanonInstructions(value);
  assert.match(instructions, /LOCKED ODDLING PASSPORT/);
  assert.match(instructions, /show=/);
  assert.match(instructions, /canon=/);
  assert.match(instructions, /motion=performs one simple repeatable dance move/);
  assert.match(instructions, /Scene:A recurring kitchen set/);
  assert.match(instructions, /generation models have no memory/);
  assert.ok(instructions.length <= ODDLING_CANON_MAX);
});

test('a successful instruction save binds the passport durably to its user and thread, then consumes the one-time launch', () => {
  const launchStorage = memory();
  const durableStorage = memory();
  writeOddlingChatHandoff(launchStorage, { ownerId: USER_A, picks: ODDLING_ARCHETYPES[0].picks, scene: 'Scene one' }, NOW, LAUNCH_A);
  const bound = bindOddlingThreadContext(launchStorage, durableStorage, USER_A, 'thread-a', LAUNCH_A, LOCKED_PROMPT, NOW + 1000);
  assert.equal(bound.scene, 'Scene one');
  assert.equal(bound.instructions, LOCKED_PROMPT, 'the live session keeps the exact prompt for every later atomic send');
  assert.equal(launchStorage.getItem(ODDLING_CHAT_HANDOFF_KEY), null);
  assert.equal(readOddlingChatHandoff(launchStorage, LAUNCH_A, USER_A, NOW + 1000), null);
  assert.equal(readOddlingThreadContext(durableStorage, USER_A, 'thread-a', NOW + 2000).picks.oddling_name, bound.picks.oddling_name);
  assert.equal(readMatchingOddlingThreadContext(durableStorage, USER_A, 'thread-a', LOCKED_PROMPT, NOW + 2000).scene, 'Scene one');
  assert.equal(readOddlingThreadContext(durableStorage, USER_B, 'thread-a', NOW + 2000), null, 'another signed-in user cannot receive it');
  assert.equal(readOddlingThreadContext(durableStorage, USER_A, 'thread-b', NOW + 2000), null);
  removeOddlingThreadContext(durableStorage, USER_A, 'thread-a');
  assert.equal(readOddlingThreadContext(durableStorage, USER_A, 'thread-a', NOW + 2000), null);
  assert.equal(writeOddlingThreadContext(durableStorage, USER_A, 'thread-b', bound, LOCKED_PROMPT, NOW + 3000), true, 'trusted context can follow a no-charge retry into its replacement thread');
  assert.equal(readOddlingThreadContext(durableStorage, USER_A, 'thread-b', NOW + 4000).scene, 'Scene one');
});

test('a changed server prompt blocks the lock without discarding its passport or expected canon', () => {
  const storage = memory();
  writeOddlingChatHandoff(storage, { ownerId: USER_A, picks: ODDLING_ARCHETYPES[0].picks }, NOW, LAUNCH_A);
  bindOddlingThreadContext(storage, storage, USER_A, 'thread-a', LAUNCH_A, LOCKED_PROMPT, NOW + 1);
  assert.equal(readMatchingOddlingThreadContext(storage, USER_A, 'thread-a', `${LOCKED_PROMPT} changed`, NOW + 2), null);
  assert.equal(readOddlingThreadContext(storage, USER_A, 'thread-a', NOW + 3).instructions, LOCKED_PROMPT,
    'the expected canon remains available for an explicit blocked state and cannot silently become ordinary chat');
});

test('Oddling Chat handoff rejects corrupt, expired and mismatched data without consuming a different launch', () => {
  const storage = memory();
  assert.equal(writeOddlingChatHandoff(storage, { ownerId: USER_A, picks: {} }, NOW, LAUNCH_A), '');
  storage.setItem(ODDLING_CHAT_HANDOFF_KEY, '{broken');
  assert.equal(readOddlingChatHandoff(storage, LAUNCH_A, USER_A, NOW), null);
  assert.equal(storage.getItem(ODDLING_CHAT_HANDOFF_KEY), null);
  assert.equal(writeOddlingChatHandoff(storage, { ownerId: USER_A, picks: ODDLING_ARCHETYPES[0].picks }, NOW, LAUNCH_A), LAUNCH_A);
  assert.equal(bindOddlingThreadContext(storage, storage, USER_A, 'thread-a', LAUNCH_B, LOCKED_PROMPT, NOW + 1), null);
  assert.ok(storage.getItem(ODDLING_CHAT_HANDOFF_KEY), 'a mismatch leaves the correct launch available');
  assert.equal(removeOddlingChatHandoff(storage, LAUNCH_B), false, 'a stale URL cannot remove another pending launch');
  assert.ok(storage.getItem(ODDLING_CHAT_HANDOFF_KEY), 'the correct launch is still pending');
  assert.equal(removeOddlingChatHandoff(storage, LAUNCH_A), true, 'an exact rejected launch can be removed');
  assert.equal(storage.getItem(ODDLING_CHAT_HANDOFF_KEY), null);
  assert.equal(writeOddlingChatHandoff(storage, { ownerId: USER_A, picks: ODDLING_ARCHETYPES[0].picks }, NOW, LAUNCH_A), LAUNCH_A);
  assert.equal(readOddlingChatHandoff(storage, LAUNCH_A, USER_A, NOW + ODDLING_CHAT_HANDOFF_MAX_AGE + 1), null);
  assert.equal(storage.getItem(ODDLING_CHAT_HANDOFF_KEY), null);
});

test('thread bindings expire independently and blocked browser storage fails closed', () => {
  const storage = memory();
  writeOddlingChatHandoff(storage, { ownerId: USER_A, picks: ODDLING_ARCHETYPES[0].picks }, NOW, LAUNCH_A);
  bindOddlingThreadContext(storage, storage, USER_A, 'thread-a', LAUNCH_A, LOCKED_PROMPT, NOW);
  assert.equal(readOddlingThreadContext(storage, USER_A, 'thread-a', NOW + ODDLING_CHAT_THREAD_MAX_AGE + 1), null);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(writeOddlingChatHandoff(blocked, { ownerId: USER_A, picks: ODDLING_ARCHETYPES[0].picks }, NOW, LAUNCH_A), '');
  assert.equal(readOddlingChatHandoff(blocked, LAUNCH_A, USER_A, NOW), null);
  assert.equal(bindOddlingThreadContext(blocked, blocked, USER_A, 'thread-a', LAUNCH_A, LOCKED_PROMPT, NOW), null);
});

test('the maximum legal visual passport keeps every category in bounded canon and the full four-skill prompt', () => {
  const picks = Object.fromEntries(CHARACTER_GROUPS.map((group) => [group.id, group.options.at(-1)[0]]));
  Object.assign(picks, {
    oddling_name: 'N'.repeat(40), oddling_obsession: 'P'.repeat(140), oddling_rule: 'C'.repeat(160),
    oddling_voice: ODDLING_ARCHETYPES[0].picks.oddling_voice, oddling_show: ODDLING_ARCHETYPES[0].picks.oddling_show,
  });
  const canon = oddlingCanonInstructions({ version: 2, savedAt: NOW, ownerId: USER_A, picks, mode: 'motion', scene: 'S'.repeat(300), referenceNote: 'R'.repeat(180) });
  assert.match(canon, new RegExp(`premise=${'P'.repeat(140)}`));
  assert.match(canon, new RegExp(`canon=${'C'.repeat(160)}`));
  assert.match(canon, new RegExp(`Scene:${'S'.repeat(300)}`));
  assert.match(canon, new RegExp(`Reference:${'R'.repeat(180)}`));
  for (const group of CHARACTER_GROUPS) assert.match(canon, new RegExp(`=${group.options.at(-1)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:;|\\n|$)`), group.id);
  assert.ok(canon.length <= ODDLING_CANON_MAX);
});

test('launch ids are opaque and malformed random ids fail closed', () => {
  assert.equal(makeOddlingChatLaunchId({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }), '12345678123412341234123456789abc');
  assert.equal(makeOddlingChatLaunchId({ randomUUID: () => 'not safe?' }), '');
  assert.equal(makeOddlingChatLaunchId({ randomUUID: () => { throw new Error('missing'); } }), '');
});

test('a delayed bind can finish only on its original live Chat launch', () => {
  const current = { left: false, atNewChat: true, pathname: '/app/chat', urlLaunchId: LAUNCH_A, refLaunchId: LAUNCH_A, expectedLaunchId: LAUNCH_A, generation: 2, expectedGeneration: 2 };
  assert.equal(canFinishOddlingLaunch(current), true);
  for (const changed of [
    { left: true }, { atNewChat: false }, { pathname: '/app/oddlings' }, { urlLaunchId: LAUNCH_B }, { refLaunchId: LAUNCH_B }, { generation: 3 },
  ]) assert.equal(canFinishOddlingLaunch({ ...current, ...changed }), false, JSON.stringify(changed));
});
