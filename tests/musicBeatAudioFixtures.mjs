import { make } from './musicBeatFixtures.mjs';
import { addAudioRegion, setTempo } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { soundDuration } from '../app/veyrnox/_lib/music/beat/beatSounds.mjs';
export const takeAsset = (durationSec = 3) => ({ source: 'take', ref: 'shelf-one', name: 'Take', durationSec, bpm: null, sourceChannels: 1, encodedBytes: 0 });
export const soundAsset = (bpm = 60) => ({ source: 'sound', ref: 'sub-one', name: 'Bass loop 1', durationSec: soundDuration('sub-one', bpm), bpm: null, sourceChannels: 2, encodedBytes: 0 });
export const audioDoc = (asset = takeAsset()) => addAudioRegion(setTempo(make(), 60, 0), asset, null, 0, 0);
export const audioRegion = (doc) => doc.tracks.find((t) => t.kind === 'audio').regions[0];
