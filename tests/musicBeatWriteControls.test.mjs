import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, find, button } from './helpers/musicBeatComponentHarness.mjs';
import { configureBeatWrites, capabilityGeneration } from '../app/veyrnox/_lib/music/beat/beatWriteVersion.mjs';
import { v5BeatFixture } from './fixtures/musicBeatV5.mjs';
import * as magic from '../app/veyrnox/_lib/music/beat/magicBar.mjs';
const layer = { songId: 'b77dcbd3-d1c6-4a86-b93b-58025d882a95', title: 'Existing loop', bars: 4, bpm: 120, muted: false, audioUrl: '/api/v1/jobs/b77dcbd3-d1c6-4a86-b93b-58025d882a95/asset' };
test.afterEach(() => configureBeatWrites(false));
test('read-only existing layer remove/mute/add never write localStorage; stale add is refused', async t => {
  const h = harness(), saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify([layer]), setItem: () => { writes++; } } });
  t.after(() => { h.close(); if (saved) Object.defineProperty(globalThis, 'localStorage', saved); else delete globalThis.localStorage; });
  const { useBeatLoopLayers } = h.load('useBeatLoopLayers', { '../../../_lib/gateway': {}, '../../../_lib/music/beat/magicBar.mjs': magic }, 'js');
  const current = { current: v5BeatFixture() }; let loops;
  h.render(() => { loops = useBeatLoopLayers(current.current.id, false, current); }); await h.settle();
  for (const act of [() => loops.remove(layer.songId), () => loops.toggleMute(layer.songId), () => loops.add(layer)]) { act(); await h.settle(); }
  assert.equal(writes, 0); assert.equal(loops.layers.length, 1); assert.equal(loops.layers[0].muted, false); assert.match(loops.error, /read-only/);
  configureBeatWrites(true); const generation = capabilityGeneration(); configureBeatWrites(false); configureBeatWrites(true);
  loops.add(layer, generation); await h.settle(); assert.equal(writes, 0);
  loops.toggleMute(layer.songId); await h.settle(); assert.equal(writes, 1); assert.equal(loops.layers[0].muted, true);
});
test('Magic Bar quote cannot submit after rollback; existing loop controls stay visible and disabled', async t => {
  const h = harness(), calls = []; t.after(() => h.close());
  const Bar = h.load('BeatMagicBar', {
    '../../../_lib/useMusicCelebrations': { useMusicCelebrations: () => () => {} },
    '../../../_lib/music/beat/magicBar.mjs': { ...magic, startExampleRotation: () => () => {} },
    '../../../_lib/useMusicAudioSrc': { MusicPrivateAudio: () => null },
    '../../../_lib/gateway': { gatewayFetch: async (path, init) => { calls.push(path); init.beforeSend?.(); return { quote_id: 'q', affordable: true, total_credits: 2 }; } },
  }).default;
  configureBeatWrites(true);
  const props = { doc: v5BeatFixture(), loops: { layers: [layer] }, announce() {} };
  h.render(() => Bar(props)); await h.settle();
  find(h.tree, n => n.type === 'input').props.onChange({ target: { value: 'Warm piano' } }); await h.settle();
  await find(h.tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  const send = find(h.tree, n => n.type === 'button' && n.props.onClick?.name === 'confirm').props.onClick;
  configureBeatWrites(false); h.render(); await h.settle();
  assert.equal(button(h.tree, 'Mute').props.disabled, true); assert.equal(button(h.tree, 'Remove').props.disabled, true);
  await send(); await h.settle(); assert.deepEqual(calls, ['/music/generation-quotes']);
  assert.match(find(h.tree, n => n.props.role === 'alert').props.children, /read-only/);
});
test('microphone arming and preparation refuse v5 before capture or take hydration', async t => {
  const h = harness(), previous = globalThis.window; globalThis.window = new EventTarget();
  t.after(() => { h.close(); globalThis.window = previous; });
  const { useBeatAudioRecording } = h.load('useBeatAudioRecording', {
    '../../../_lib/music/beat/beatCapture.js': { openBeatCapture: () => assert.fail('must not arm microphone') },
    '../../../_lib/music/beat/beatLatency.mjs': {}, '../../../_lib/music/beat/beatAudioRecordingSession.js': {},
    '../../../_lib/music/beat/beatTakeOps.mjs': {}, '../../../_lib/music/beat/beatAudioSegments.mjs': {},
    '../../../_lib/music/beat/beatTakeStore.js': { reconcileBeatTakes: async () => {}, pendingBeatTakes: () => [], hydrateBeatTakes: () => assert.fail('must not prepare takes') },
  }, 'js');
  const current = { current: v5BeatFixture() }, announced = [], announce = s => announced.push(s);
  let recorder;
  h.render(() => { recorder = useBeatAudioRecording(current, () => assert.fail('no edit'), announce, () => assert.fail('no audio context'), async () => {}); }); await h.settle();
  await recorder.arm('t1'); await h.settle(); assert.equal(recorder.armedId, null); assert.match(announced.at(-1), /read-only/);
  await assert.rejects(recorder.prepare(0), { code: 'v5_write_disabled' });
});
