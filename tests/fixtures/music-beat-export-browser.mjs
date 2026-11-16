import { createBeat } from '../../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { addMidiTrack, addMidiRegion } from '../../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
import { addAudioRegion } from '../../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { renderSong } from '../../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { planExport, chunkPlan, assembleExport } from '../../app/veyrnox/_lib/music/beat/beatExport.mjs';
import { createWavWriter, encodeWavChannels } from '../../app/veyrnox/_lib/music/beat/beatWav.mjs';
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
export async function measureExportBoundary() {
  let doc = createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
  doc.tempo.bpm = 120; doc.swing = 0.37;
  doc.tracks[0].regions[0].length = 125 * 1920;
  for (const pad of ['kick', 'hat', 'snare']) doc.patterns.A.rows[pad] = Array.from({ length: 16 }, (_, i) => [i, 100]);
  doc = addMidiRegion(addMidiTrack(doc, { engine: 'voice', id: 'synth', preset: 'pad' }, 0), 't2', 0, 0);
  doc.clips.c1.lengthTicks = 64 * 3840; doc.tracks[1].regions[0].length = 125 * 1920;
  doc.clips.c1.notes = [[59 * 1920, 3 * 1920, 60, 100], [119 * 1920, 3 * 1920, 64, 100]];
  doc = addAudioRegion(doc, { source: 'take', ref: 'boundary-take', name: 'Boundary audio', durationSec: 4,
    bpm: null, sourceChannels: 1, encodedBytes: 0 }, null, 0, 0);
  doc.tracks[2].regions[0].length = 125 * 1920;
  const buffer = new OfflineAudioContext(1, 1, 48000).createBuffer(1, 4 * 48000, 48000);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = 0.12 * Math.sin(i / 48000 * 2 * Math.PI * 220);
  const buffers = new Map([[doc.tracks[2].regions[0].assetId, { buffer }]]), planned = planExport(doc);
  const whole = await renderSong(doc, { buffers, range: 'song' });
  const wav = encodeWavChannels(whole.channels, 48000), wholeHash = await digest(wav);
  const repeat = await assembleExport(planned, chunk => renderSong(doc, { buffers, range: 'song', ...chunk }), createWavWriter(planned));
  const repeatedHash = await digest(repeat);
  let maxSampleDifference = 0;
  for (const chunk of chunkPlan(doc)) {
    const result = await renderSong(doc, { buffers, range: 'song', ...chunk }), start = Math.round(chunk.startSec * 48000);
    for (let c = 0; c < 2; c++) for (let frame = 0; frame < result.channels[c].length; frame++) {
      maxSampleDifference = Math.max(maxSampleDifference, Math.abs(whole.channels[c][start + frame] - result.channels[c][frame]));
    }
  }
  return { wholeHash, repeatedHash, byteIdentical: wholeHash === repeatedHash, maxSampleDifference, limit: 1 / 32768 };
}
