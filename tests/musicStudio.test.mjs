import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicStudioEnabled } from '../lib/musicBackend.js';

const workspaceUrl = new URL('../app/veyrnox/_components/music/MusicStudioWorkspace.jsx', import.meta.url);
const recorderUrl = new URL('../app/veyrnox/_components/music/MusicStudioRecorder.jsx', import.meta.url);
const midiUrl = new URL('../app/veyrnox/_components/music/MusicStudioMidi.jsx', import.meta.url);
const effectsUrl = new URL('../app/veyrnox/_components/music/MusicStudioEffects.jsx', import.meta.url);
const clipEditorUrl = new URL('../app/veyrnox/_components/music/MusicStudioClipEditor.jsx', import.meta.url);
const latencyUrl = new URL('../app/veyrnox/_components/music/MusicStudioLatencyCalibration.jsx', import.meta.url);
const songRouteUrl = new URL('../app/api/v1/music/songs/[id]/route.js', import.meta.url);

test('Studio rollout composes schema and private Library gates', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_STUDIO_ENABLED: 'true' };
  assert.equal(musicStudioEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicStudioEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('song projection exposes Studio only through the independent disabled gate', async () => {
  const route = await readFile(songRouteUrl, 'utf8');
  assert.match(route, /musicStudioEnabled\(\) \? \['open_studio'\] : \[\]/);
});

test('Studio workspace is functional but explicit about local-only capability limits', async () => {
  const source = await readFile(workspaceUrl, 'utf8');
  assert.match(source, /audio\.play\(\)/);
  assert.match(source, /60000 \/ tempo/);
  assert.match(source, /Tempo and time signature guide the grid and metronome; they do not stretch the source/);
  assert.match(source, /Local clip renders, microphone takes, measured latency, MIDI notes, effects and automation are unsaved/);
  assert.doesNotMatch(source, /gatewayFetch\([^\n]*method:\s*'POST'/);
});

test('Studio latency calibration measures returned clicks without claiming take alignment', async () => {
  const source = await readFile(latencyUrl, 'utf8');
  assert.match(source, /CLICK_OFFSETS = Object\.freeze\(\[0\.15, 0\.45, 0\.75\]\)/);
  assert.match(source, /createMediaStreamSource\(stream\)/);
  assert.match(source, /createAnalyser\(\)/);
  assert.match(source, /getFloatTimeDomainData\(samples\)/);
  assert.match(source, /now - expected/);
  assert.match(source, /does not shift, align or persist recorded takes/);
  assert.doesNotMatch(source, /gatewayFetch|fetch\(|localStorage|sessionStorage/);
});

test('Studio clip settings render bounded reversible tuned fades to a local PCM WAV', async () => {
  const source = await readFile(clipEditorUrl, 'utf8');
  assert.match(source, /MAX_PREVIEW_SECONDS = 60/);
  assert.match(source, /fetch\(sourceUrl, \{ credentials: 'same-origin' \}\)/);
  assert.match(source, /2 \*\* \(\(bounded\(semitones/);
  assert.match(source, /reverse \? endFrame - 1 - index \* pitchRate/);
  assert.match(source, /curve === 'exponential'/);
  assert.match(source, /curve === 'logarithmic'/);
  assert.match(source, /encodeAudioBufferAsWav\(output\)/);
  assert.match(source, /URL\.createObjectURL\(file\)/);
  assert.match(source, /No pitch-preserving time stretch, formant control, warp markers/);
  assert.doesNotMatch(source, /gatewayFetch|localStorage|sessionStorage/);
});

test('Studio effects process the real media element and automation drives audible master gain', async () => {
  const source = await readFile(effectsUrl, 'utf8');
  assert.match(source, /createMediaElementSource\(audio\)/);
  assert.match(source, /createBiquadFilter\(\)/);
  assert.match(source, /createDynamicsCompressor\(\)/);
  assert.match(source, /createWaveShaper\(\)/);
  assert.match(source, /createDelay\(1\)/);
  assert.match(source, /createConvolver\(\)/);
  assert.match(source, /tail\.connect\(device\.input\)/);
  assert.match(source, /manualVolume \* effectiveAutomation/);
  assert.match(source, /MAX_AUTOMATION_POINTS = 16/);
  assert.match(source, /MAX_EFFECTS = 10/);
  assert.match(source, /parameters: \{ \.\.\.effect\.parameters \}/);
  assert.match(source, /Paste copied effect/);
  assert.match(source, /No cross-track move, gate, sidechain, presets, parameter curves, custom chat plugins, saved project state, offline render or effect-bearing export/);
  assert.doesNotMatch(source, /gatewayFetch|fetch\(|localStorage|sessionStorage/);
});

test('Studio recorder requests a chosen input on intent and creates only local PCM WAV takes', async () => {
  const source = await readFile(recorderUrl, 'utf8');
  assert.match(source, /getUserMedia\(inputConstraint\(inputId\)\)/);
  assert.match(source, /enumerateDevices\(\)/);
  assert.match(source, /\['audio\/webm;codecs=opus', 'audio\/mp4', 'audio\/webm'\]/);
  assert.match(source, /encodeAudioBufferAsWav\(decoded\)/);
  assert.match(source, /URL\.createObjectURL\(file\)/);
  assert.match(source, /count-in/);
  assert.match(source, /pre-roll/);
  assert.match(source, /\[1, 2, 4\]|<option value="1">1 bar/);
  assert.match(source, /not latency-corrected/);
  assert.doesNotMatch(source, /gatewayFetch|fetch\(/);
});

test('Studio MIDI stays local while providing a bounded wavetable instrument, typing, Web MIDI and note editing', async () => {
  const source = await readFile(midiUrl, 'utf8');
  assert.match(source, /navigator\.requestMIDIAccess\(\{ sysex: false \}\)/);
  assert.match(source, /Safari does not expose Web MIDI/);
  assert.match(source, /const TYPING_NOTES/);
  assert.match(source, /Math\.round\(note\.start \* 4\) \/ 4/);
  assert.match(source, /Pitch note/);
  assert.match(source, /Length beats note/);
  assert.match(source, /Velocity note/);
  assert.match(source, /createPeriodicWave/);
  assert.match(source, /oscillatorA\.setPeriodicWave/);
  assert.match(source, /oscillatorB\.setPeriodicWave/);
  assert.match(source, /filter\.type = 'lowpass'/);
  assert.match(source, /lfo\.connect\(lfoGain\)\.connect\(filter\.frequency\)/);
  assert.match(source, /const MAX_VOICES = 12/);
  assert.match(source, /Floating wavetable keyboard/);
  assert.match(source, /no table upload\/capture, mod matrix, MIDI Learn, chat design, generated cover or saved project/i);
  assert.doesNotMatch(source, /gatewayFetch|fetch\(|localStorage|sessionStorage/);
});
