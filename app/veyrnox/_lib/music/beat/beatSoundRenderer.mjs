import { makeNoise, playEvent } from '../instrumentEngine.js';
import { AUDIO_RATE } from './beatAudioRules.mjs';
import { soundById, soundDuration } from './beatSounds.mjs';

/**
 * Render one production Starter Sound without depending on browser state.
 *
 * Callers own the context factory so web and native export share the same
 * graph while retaining their platform-specific OfflineAudioContext adapter.
 * `random` is intentionally optional: live preview remains unseeded, while
 * export supplies a deterministic generator derived from the document ID.
 */
export async function renderStarterSound(ref, bpm, createOfflineContext, random) {
  const sound = soundById(ref);
  if (!sound) throw new Error('Starter sound is unavailable');
  const duration = soundDuration(ref, bpm);
  const context = createOfflineContext(2, Math.round(duration * AUDIO_RATE), AUDIO_RATE);
  const out = context.createGain(); out.gain.value = 0.65;
  if (sound.category === 'FX') {
    const sweep = context.createBiquadFilter(); sweep.type = 'lowpass';
    sweep.frequency.setValueAtTime(150, 0);
    sweep.frequency.exponentialRampToValueAtTime(8000, duration);
    out.connect(sweep).connect(context.destination);
  } else out.connect(context.destination);
  const noise = makeNoise(context, 1, random);
  for (const [beat, length, value, vel] of sound.notes) playEvent(context, out, noise, sound.instrument, sound.preset,
    { value, vel, dur: length * 60 / bpm }, beat * 60 / bpm);
  return context.startRendering();
}
