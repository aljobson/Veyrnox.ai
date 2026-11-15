import { SAMPLE_RATE } from '../../../../../lib/musicInstruments.js';
import { makeNoise, playEvent } from '../instrumentEngine.js';
import { beatOutput, connectTrackChannel } from './beatEngine.js';
import { patternEvents, eventsAtStep, editTrack } from './beatEvents.mjs';
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
      playEvent(context, master, noise, 'drums', doc.version === 1 ? doc.kit : editTrack(doc, editTrackId).kit, { value: event.pad, vel: event.velocity }, loop * length + stepTime(event.step, doc.tempo.bpm, doc.swing));
    }
  }
  const rendered = await context.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: rendered.sampleRate };
}

export { exportRange, BeatExportError } from './beatSequence.mjs';
import { exportSize } from './beatSequence.mjs';
export async function renderSong(doc) {
  const { startStep, endStep, frames } = exportSize(doc, SAMPLE_RATE);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  const context = new Offline(2, frames, SAMPLE_RATE);
  const master = beatOutput(context);
  const noise = makeNoise(context);
  const channels = new Map(doc.tracks.map((track) => [track.id,
    connectTrackChannel(context, master, track.gain, track.pan).input]));
  const song = { ...doc, view: 'song' };
  for (let step = startStep; step < endStep; step++) {
    const time = eventTime((step - startStep) * stepSeconds(doc.tempo.bpm), step, doc.tempo.bpm, doc.swing);
    for (const event of eventsAtStep(song, step)) {
      const track = doc.tracks.find((t) => t.id === event.trackId);
      playEvent(context, channels.get(track.id), noise, 'drums', track.kit,
        { value: event.pad, vel: event.velocity }, time);
    }
  }
  const rendered = await context.startRendering();
  return { channels: [rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate: rendered.sampleRate };
}
