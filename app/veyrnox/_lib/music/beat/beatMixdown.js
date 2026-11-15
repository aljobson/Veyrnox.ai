import { startVoice, createVoicePool } from './beatVoices.js';
import { midiNoteOnsInWindow } from './beatMidiWindow.mjs';
import { effectiveGain } from './beatEvents.mjs';
import { estimateExport, usedAssets } from './beatAudioRules.mjs';
import { audioSegments } from './beatAudioSegments.mjs';
import { playAudioSegment } from './beatAudioGraph.js';
import { SAMPLE_RATE } from '../../../../../lib/musicInstruments.js';
import { makeNoise, playEvent } from '../instrumentEngine.js';
import { beatOutput, connectTrackChannel } from './beatEngine.js';
import { patternEvents, eventsAtStep, patternTrack } from './beatEvents.mjs';
import { loopSeconds, stepTime, stepSeconds, eventTime } from './beatTime.mjs';
import { validateBeat } from './beatDocument.mjs';

export async function renderBeat(doc, loops, editTrackId) {
  if (!validateBeat(doc).ok || ![1, 2, 4, 8].includes(loops)) throw new Error('Invalid beat or loop count');
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  const length = loopSeconds(doc.tempo.bpm, doc.steps);
  const context = new Offline(1, Math.ceil((length * loops + 1.5) * SAMPLE_RATE), SAMPLE_RATE);
  const master = beatOutput(context);
  const noise = makeNoise(context);
  const events = patternEvents(doc);
  for (let loop = 0; loop < loops; loop++) {
    for (const event of events) {
      playEvent(context, master, noise, 'drums', doc.version === 1 ? doc.kit : (patternTrack(doc, editTrackId)?.kit || '808'), { value: event.pad, vel: event.velocity }, loop * length + stepTime(event.step, doc.tempo.bpm, doc.swing));
    }
  }
  const rendered = await context.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: rendered.sampleRate };
}

export { exportRange, BeatExportError } from './beatSequence.mjs';
import { exportSize } from './beatSequence.mjs';
export async function loadSongBuffers(doc, progress = () => {}) {
  const { frames } = exportSize(doc, SAMPLE_RATE);
  estimateExport(doc, frames); // cold-cache refusal before any fetch, decode, or output allocation
  const ids = usedAssets(doc), buffers = new Map();
  if (!ids.length) return buffers;
  const { loadAssetBuffers, prepareExportCache } = await import('./beatAssets.js');
  prepareExportCache(doc);
  let index = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
    while (index < ids.length) {
      const id = ids[index++], asset = doc.assets[id];
      progress(`Loading ${++completed} of ${ids.length} sounds…`);
      const reversed = doc.tracks.some((t) => t.regions.some((r) => r.assetId === id && r.reverse));
      const loaded = await loadAssetBuffers(asset, doc.tempo.bpm, reversed);
      const buffer = loaded?.buffer, reverse = loaded?.reversed;
      buffers.set(id, { buffer, reverse, missing: !buffer || (reversed && !reverse) });
    }
  }));
  return buffers;
}
export async function renderSong(doc, { buffers: prepared, progress } = {}) {
  estimateExport(doc, exportSize(doc, SAMPLE_RATE).frames);
  const buffers = prepared || await loadSongBuffers(doc, progress);
  const { startStep, endStep, frames } = exportSize(doc, SAMPLE_RATE);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  const context = new Offline(2, frames, SAMPLE_RATE);
  const master = beatOutput(context);
  const noise = makeNoise(context);
  const channels = new Map(doc.tracks.map((track) => [track.id,
    connectTrackChannel(context, master, effectiveGain(doc, track.id, 'song'), track.pan).input]));
  const song = { ...doc, view: 'song' };
  for (let step = startStep; step < endStep; step++) {
    const time = eventTime((step - startStep) * stepSeconds(doc.tempo.bpm), step, doc.tempo.bpm, doc.swing);
    for (const event of eventsAtStep(song, step, { includeMuted: true })) {
      const track = doc.tracks.find((t) => t.id === event.trackId);
      playEvent(context, channels.get(track.id), noise, 'drums', track.kit,
        { value: event.pad, vel: event.velocity }, time);
    }
  }
  for (const segment of audioSegments(song, startStep * stepSeconds(doc.tempo.bpm), endStep * stepSeconds(doc.tempo.bpm), { includeMuted: true })) {
    const loaded = buffers.get(segment.assetId), buffer = segment.reverse ? loaded?.reverse : loaded?.buffer;
    if (!buffer) continue;
    const region = doc.tracks.find((t) => t.id === segment.trackId).regions.find((r) => r.id === segment.regionId);
    playAudioSegment(context, channels.get(segment.trackId), buffer, segment, region, doc.tempo.bpm,
      segment.songTimeSec - startStep * stepSeconds(doc.tempo.bpm));
  }
  const pool = createVoicePool(), from = startStep * stepSeconds(doc.tempo.bpm), to = endStep * stepSeconds(doc.tempo.bpm);
  for (const note of midiNoteOnsInWindow(song, from, to, { includeMuted: true, endSec: to })) {
    const track = doc.tracks.find((t) => t.id === note.trackId), at = note.songTimeSec - from;
    const voice = startVoice(context, channels.get(track.id), noise, track.instrument, note.pitch, note.velocity, at);
    voice.release(at + note.durationSec); pool.add(track.id, voice, at);
  }
  const rendered = await context.startRendering();
  return { channels: [rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate: rendered.sampleRate };
}
