import { SAMPLE_RATE } from '../../../../../lib/musicInstruments.js';
import { makeNoise, playEvent } from '../instrumentEngine.js';
import { beatOutput } from './beatEngine.js';
import { patternEvents } from './beatEvents.mjs';
import { loopSeconds, stepTime } from './beatTime.mjs';
import { validateBeat } from './beatDocument.mjs';

export async function renderBeat(doc, loops) {
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
      playEvent(context, master, noise, 'drums', doc.kit, { value: event.pad, vel: event.velocity }, loop * length + stepTime(event.step, doc.tempo.bpm, doc.swing));
    }
  }
  const rendered = await context.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: rendered.sampleRate };
}
