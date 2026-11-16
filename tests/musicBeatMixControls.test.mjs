import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automationControl, effectParamLive, sendLevelLive, masterPatchLive } from '../app/veyrnox/_lib/music/beat/beatMixControls.mjs';
import { recordingEditAllowed } from '../app/veyrnox/_lib/music/beat/beatRecordingPolicy.mjs';
import { DEFAULT_MASTER, patternTailSeconds, mixTailSeconds } from '../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
import { addEffect } from '../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
import { make } from './musicBeatFixtures.mjs';
const source = name => readFile(new URL(`../app/veyrnox/_components/music/beat/${name}`, import.meta.url), 'utf8');
test('recording allows continuous mixer edits but refuses changes requiring a graph restart', () => {
  const allowed = liveMix => recordingEditAllowed(true, { liveMix });
  for (const param of ['low', 'mid', 'high', 'threshold', 'ratio', 'drive', 'time', 'feedback', 'mix']) assert.equal(allowed(effectParamLive(param)), true);
  assert.equal(allowed(effectParamLive('size')), false);
  const track = { sends: { reverb: 0.2, delay: 0 } };
  assert.equal(allowed(sendLevelLive(track, 'reverb', 0.7)), true);
  assert.equal(allowed(sendLevelLive(track, 'reverb', 0)), false);
  assert.equal(allowed(sendLevelLive(track, 'delay', 0.3)), false);
  const doc = { master: DEFAULT_MASTER };
  for (const patch of [{ gain: 0.3 }, { delay: { time: 0.2 } }, { delay: { feedback: 0.4 } }]) {
    assert.equal(allowed(masterPatchLive(doc, patch)), true);
    assert.equal(allowed(masterPatchLive({}, patch)), false, 'adding the master section is structural');
  }
  assert.equal(allowed(masterPatchLive(doc, { limiter: false })), false);
  assert.equal(allowed(masterPatchLive(doc, { reverb: { size: 4 } })), false);
  assert.equal(recordingEditAllowed(true, {}), false, 'structural operations do not opt in');
});
test('gain and pan lock independently in song view and pattern-view recording, with lane-specific explanations', () => {
  for (const lane of ['gain', 'pan']) {
    const track = { automation: { [lane]: [[0, 0.5, 0]] } }, other = lane === 'gain' ? 'pan' : 'gain';
    for (const [mode, recording, disabled] of [['song', false, true], ['song', true, true], ['pattern', false, false], ['pattern', true, true]]) {
      assert.equal(automationControl(track, lane, mode, recording).disabled, disabled);
      assert.equal(automationControl(track, other, mode, recording).disabled, false);
    }
  }
  assert.equal(automationControl({}, 'gain', 'song').message, 'Gain is automated — clear the lane to use the fader');
  assert.equal(automationControl({}, 'pan', 'song').message, 'Pan is automated — clear the lane to use the pan control');
});
test('UI recording permissions reach the project edit gate and native control lock; both track views receive recording state', async () => {
  const [editor, arrangement, mixer, channel, header, range, rack, master] = await Promise.all([
    'BeatEditor.jsx', 'BeatArrangement.jsx', 'BeatMixer.jsx', 'BeatChannelStrip.jsx', 'BeatTrackHeader.jsx', 'BeatMixControl.jsx', 'BeatEffectRack.jsx', 'BeatMasterStrip.jsx',
  ].map(source));
  assert.match(editor, /BeatArrangement recording=\{playback.recordingRun\}/);
  assert.match(editor, /BeatMixer recording=\{playback.recordingRun\}/);
  assert.match(arrangement, /BeatTrackHeader recording=\{recording\}/);
  assert.match(mixer, /BeatChannelStrip[^>]*recording=\{recording\}/);
  for (const text of [channel, header]) {
    assert.match(text, /automationControl\(track, 'gain', (?:doc.view|mode), recording\)/);
    assert.match(text, /automationControl\(track, 'pan', (?:doc.view|mode), recording\)/);
    assert.match(text, /disabled=\{gain.disabled\}/); assert.match(text, /disabled=\{pan.disabled\}/);
    assert.match(text, /gain.message/); assert.match(text, /pan.message/);
  }
  assert.match(range, /data-beat-live=\{liveMix \|\| undefined\}/);
  assert.match(rack, /liveMix: op === ops.setEffectParam && effectParamLive\(args\[1\]\)/);
  assert.match(rack, /MixRange liveMix=\{effectParamLive\(param\)\}/);
  assert.match(channel, /liveMix: sendLevelLive\(track, bus, v\)/);
  assert.match(channel, /MixRange liveMix=\{track.sends\?\.\[bus\] > 0\}/);
  assert.match(master, /liveMix: masterPatchLive\(doc, patch\)/);
  assert.match(master, /MixRange liveMix=\{!!doc.master\}/);
});
test('export length copy uses the rendered selection tail, including a legacy pattern beside a mixed track', async () => {
  const doc = addEffect(make(), 't1', 'reverb'); doc.tracks[0].fx[0].params.size = 4;
  assert.equal(mixTailSeconds(doc), 4); assert.equal(patternTailSeconds(doc, doc.tracks[0]), 4);
  assert.equal(patternTailSeconds(doc, { gain: 1, pan: 0 }), 1.5);
  assert.equal(patternTailSeconds(make(), make().tracks[0]), 1.5);
  const dialog = await source('BeatExportDialog.jsx');
  assert.doesNotMatch(dialog, /WAV with a 1\.5 second tail/);
  assert.match(dialog, /patternTailSeconds\(displayed, patternTrack\(displayed, editTrackId\)\)/);
  assert.match(dialog, /mixTailSeconds\(displayed\)\)\.toFixed\(1\)/);
});
