import { beatEnglish } from './beatDisplay.mjs';
import { buildMaster, buildTrackStrip } from './beatMixGraph.js';
import { patternTailSeconds, trackHasMix } from './beatMixRules.mjs';
import { assertNoHeldAssets } from './beatAssetAvailability.mjs';
import { startVoice, createVoicePool } from './beatVoices.js';
import { midiNoteOnsInWindow } from './beatMidiWindow.mjs';
import { trackContributes } from './beatEvents.mjs';
import { estimateExport, usedAssets } from './beatAudioRules.mjs';
import { audioSegments } from './beatAudioSegments.mjs';
import { playAudioSegment } from './beatAudioGraph.js';
import { AUDIO_RATE } from './beatAudioRules.mjs';
import { seededRandom, exportSeed } from './beatSeed.mjs';
import { chunkPlan } from './beatExport.mjs';
import { SAMPLE_RATE } from '../../../../../lib/musicInstruments.js';
import { makeNoise, playEvent } from '../instrumentEngine.js';
import { beatOutput } from './beatEngine.js';
import { patternEvents, eventsAtStep, patternTrack } from './beatEvents.mjs';
import { loopSeconds, stepTime, stepSeconds, eventTime } from './beatTime.mjs';
import { validateBeat } from './beatDocument.mjs';

export async function renderBeat(doc, loops, editTrackId) {
  if (!validateBeat(doc).ok || ![1, 2, 4, 8].includes(loops)) throw new Error('Invalid beat or loop count');
  if (doc.version !== 1 && patternTrack(doc, editTrackId)?.kind === 'midi') throw new Error('Use song export to export MIDI tracks. Pattern export is for drum tracks.');
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  const length = loopSeconds(doc.tempo.bpm, doc.steps);
  const track = doc.version !== 1 && patternTrack(doc, editTrackId);
  const mixed = track && (doc.master || trackHasMix(track));
  const context = new Offline(1, Math.ceil((length * loops + patternTailSeconds(doc, track)) * SAMPLE_RATE), SAMPLE_RATE);
  const section = mixed ? buildMaster(context, doc) : null;
  const master = mixed ? buildTrackStrip(context, section, track, { doc, automationActive: false }).input : beatOutput(context);
  if (section?.errors.length) throw new Error(section.errors[0]);
  const noise = makeNoise(context, 1, seededRandom(exportSeed(doc)));
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
export async function loadSongBuffers(doc, progress = () => {}, range = 'song', t = beatEnglish) {
  const { frames } = exportSize(doc, AUDIO_RATE, range);
  estimateExport(doc, frames); // cold-cache refusal before any fetch, decode, or output allocation
  const ids = usedAssets(doc), buffers = new Map();
  if (!ids.length) return buffers;
  const { loadAssetBuffers, prepareExportCache, renderSound, assetState } = await import('./beatAssets.js');
  assertNoHeldAssets(doc, assetState);
  prepareExportCache(doc);
  let index = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
    while (index < ids.length) {
      const id = ids[index++], asset = doc.assets[id];
      progress(t('app.music.beat.recovery.r86', { count: ++completed, total: ids.length }), completed / ids.length);
      const reversed = doc.tracks.some((t) => t.regions.some((r) => r.assetId === id && r.reverse));
      let loaded;
      if (asset.source === 'sound') {
        // Live cache may contain unseeded procedural FX. Export owns a seeded
        // render so a cold cache and a warm cache produce the same bytes.
        const buffer = await renderSound(asset.ref, doc.tempo.bpm, seededRandom(exportSeed(doc)));
        let reverse;
        if (reversed) {
          const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          reverse = new Offline(2, 1, AUDIO_RATE).createBuffer(buffer.numberOfChannels, buffer.length, AUDIO_RATE);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const from = buffer.getChannelData(channel), to = reverse.getChannelData(channel);
            for (let frame = 0; frame < from.length; frame++) to[frame] = from[from.length - 1 - frame];
          }
        }
        loaded = { buffer, reversed: reverse };
      } else loaded = await loadAssetBuffers(asset, doc.tempo.bpm, reversed);
      assertNoHeldAssets(doc, assetState);
      const buffer = loaded?.buffer, reverse = loaded?.reversed;
      buffers.set(id, { buffer, reverse, missing: !buffer || (reversed && !reverse) });
    }
  }));
  return buffers;
}
export async function renderSong(doc, { buffers: prepared, progress, range = 'song', soloTrackId, startSec = 0, endSec, originSec, assertAssets } = {}) {
  if (usedAssets(doc).some(id => ['song', 'stem', 'target'].includes(doc.assets[id]?.source))) {
    if (assertAssets) assertAssets();
    else {
      const { assetState } = await import('./beatAssets.js');
      assertNoHeldAssets(doc, assetState);
    }
  }
  const size = exportSize(doc, AUDIO_RATE, range);
  endSec ??= size.frames / AUDIO_RATE;
  if (originSec === undefined) {
    originSec = startSec === 0 ? 0 : chunkPlan(doc, { range })?.find(c => c.startSec === startSec)?.originSec;
  }
  if (!(originSec >= 0 && originSec <= startSec && endSec > startSec && endSec <= size.frames / AUDIO_RATE)) throw new Error('Invalid render window.');
  const frames = Math.round(endSec * AUDIO_RATE) - Math.round(originSec * AUDIO_RATE);
  estimateExport(doc, frames);
  const buffers = prepared || await loadSongBuffers(doc, progress, range);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  const context = new Offline(2, frames, AUDIO_RATE), master = buildMaster(context, doc);
  const noise = makeNoise(context, 1, seededRandom(exportSeed(doc)));
  const tracks = doc.tracks.filter(t => trackContributes(doc, t.id, 'song') && (!soloTrackId || t.id === soloTrackId));
  const strips = new Map(tracks.map(t => [t.id, buildTrackStrip(context, master, t, { doc, automationActive: true })]));
  if (master.errors.length) throw new Error(master.errors[0]);
  const channels = new Map([...strips].map(([id, strip]) => [id, strip.input]));
  const song = { ...doc, tracks, view: 'song' }, step = stepSeconds(doc.tempo.bpm);
  const from = size.startStep * step, to = size.endStep * step, origin = from + originSec;
  for (const strip of strips.values()) strip.schedule({ fromSec: origin, toSec: Math.min(to, from + endSec), contextTime: 0 });
  // Track order is document order; voices within each track are chronological.
  for (const track of tracks) {
    const single = { ...song, tracks: [track] };
    for (let i = size.startStep; i < size.endStep; i++) {
      const time = eventTime((i - size.startStep) * step, i, doc.tempo.bpm, doc.swing);
      if (time < originSec || time >= endSec) continue;
      for (const event of eventsAtStep(single, i)) playEvent(context, channels.get(track.id), noise, 'drums', track.kit,
        { value: event.pad, vel: event.velocity }, time - originSec);
    }
    for (const segment of audioSegments(single, origin, Math.min(to, from + endSec))) {
      const loaded = buffers.get(segment.assetId), buffer = segment.reverse ? loaded?.reverse : loaded?.buffer;
      if (!buffer) continue;
      const region = track.regions.find(r => r.id === segment.regionId);
      playAudioSegment(context, channels.get(track.id), buffer, segment, region, doc.tempo.bpm, segment.songTimeSec - origin);
    }
    const pool = createVoicePool();
    for (const note of midiNoteOnsInWindow(single, origin, Math.min(to, from + endSec), { endSec: to })) {
      const at = note.songTimeSec - origin;
      const voice = startVoice(context, channels.get(track.id), noise, track.instrument, note.pitch, note.velocity, at);
      voice.release(at + note.durationSec); pool.add(track.id, voice, at);
    }
  }
  const rendered = await context.startRendering(), offset = Math.round(startSec * AUDIO_RATE) - Math.round(originSec * AUDIO_RATE);
  return { channels: [rendered.getChannelData(0).subarray(offset), rendered.getChannelData(1).subarray(offset)], sampleRate: rendered.sampleRate };
}
