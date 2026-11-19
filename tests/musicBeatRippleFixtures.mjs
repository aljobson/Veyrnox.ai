import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { addAudioTrack } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { commitRecording } from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
export function rippleFixture() {
  const doc = createBeat({ id: crypto.randomUUID(), now: 1 });
  doc.tracks[0].regions = [0, 3840, 7680].map((start, i) => ({ id: `r${i}`, start, length: 3840, offset: 0, pattern: 'A' }));
  doc.tracks.push({ ...structuredClone(doc.tracks[0]), id: 't2', regions: [{ ...doc.tracks[0].regions[0], id: 'other' }] });
  return doc;
}
export function takeRippleFixture(empty = false) {
  const doc = addAudioTrack(createBeat({ id: crypto.randomUUID(), now: 1 }), 1);
  const asset = (ref, durationSec) => ({ source: 'take', ref, name: ref, durationSec, sourceChannels: 1, encodedBytes: 0, bpm: null });
  const next = commitRecording(doc, { trackId: 't2', start: 3840, length: 3840,
    takes: [{ asset: asset('alternate', empty ? 0.01 : 8) }, { asset: asset('current', empty ? 0.01 : 8) }] }, 1);
  next.assets.aordinary = asset('ordinary', 8);
  const region = (id, start) => ({ id, start, length: 3840, assetId: 'aordinary', phaseSec: 0, gainDb: 0, fadeIn: null, fadeOut: null, reverse: false });
  next.tracks[1].regions = [region('before', 0), ...next.tracks[1].regions, region('after', 7680)];
  return next;
}
