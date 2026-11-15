import { midiToFrequency } from '../../../../../lib/musicInstruments.js';
import { GM_NOTES } from './beatMidiRules.mjs';
import { naturalVoice } from './beatNaturalVoices.js';
import { wavetableNodes } from './beatWavetable.js';
import { voiceTiming, voiceEnvelopePlan } from './beatVoiceTiming.mjs';
export { voiceEnvelopePlan } from './beatVoiceTiming.mjs';
export function startVoice(context, out, noise, instrument, pitch, velocity, at) {
  const timing = voiceTiming(instrument, instrument.preset), { id, preset, gated } = timing;
  const nodes = [], sources = [];
  // A creation facade collects all copied voice nodes, including guitar feedback.
  const owned = Object.create(null);
  for (const method of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createDelay', 'createWaveShaper']) owned[method] = (...args) => {
    const node = context[method](...args); nodes.push(node);
    if (node.start) sources.push(node);
    return node;
  };
  owned.createPeriodicWave = (...args) => context.createPeriodicWave(...args);
  const gate = owned.createGain(); gate.connect(out);
  const peak = owned.createGain(); peak.connect(gate);
  const vel = velocity / 127;
  peak.gain.value = gated ? (id === 'wavetable' ? 0.09 : id === 'piano' ? 0.32 : 0.4) * vel : 1;
  const frequency = midiToFrequency(pitch);
  if (!gated) {
    if (id !== 'drums' || GM_NOTES[pitch]) naturalVoice(owned, peak, noise, id, preset, id === 'drums' ? GM_NOTES[pitch] : pitch, at, vel);
  } else if (id === 'wavetable') wavetableNodes(owned, peak, preset, frequency, at);
  else if (id === 'piano') {
    const filter = owned.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800 + 7000 * preset.bright; filter.connect(peak);
    for (const [ratio, level] of [[1, 1], [2, 0.38 * preset.bright + 0.1], [3, 0.2 * preset.bright], [4, 0.1 * preset.bright]]) {
      const o = owned.createOscillator(), g = owned.createGain(); o.frequency.value = frequency * ratio; g.gain.value = level * 0.8;
      o.connect(g).connect(filter); o.start(at);
    }
  } else {
    const o = owned.createOscillator(), filter = owned.createBiquadFilter();
    o.type = preset.wave; o.frequency.value = frequency; filter.type = 'lowpass'; filter.frequency.setValueAtTime(preset.cutoff, at);
    if (id === 'bass') filter.frequency.exponentialRampToValueAtTime(Math.max(120, preset.cutoff * 0.25), at + preset.decay);
    o.connect(filter).connect(peak); o.start(at);
  }
  let endTime = gated ? Infinity : at + timing.natural, done = false, released = Infinity, resolve;
  const ended = new Promise((r) => { resolve = r; });
  // A silent source gives feedback-only voices a sample-clock cleanup deadline.
  const sentinel = context.createOscillator(), silence = context.createGain(); silence.gain.value = 0;
  sentinel.connect(silence).connect(out); sentinel.start(at);
  sentinel.onended = () => { done = true; for (const n of nodes) n.disconnect(); sentinel.disconnect(); silence.disconnect(); resolve(); };
  function finish(time) {
    endTime = Math.min(endTime, time);
    for (const source of sources) { try { source.stop(endTime); } catch { /* already ended */ } }
    sentinel.stop(endTime);
  }
  const initial = id === 'drums' ? [['setValueAtTime', 1, at]] : voiceEnvelopePlan(instrument, instrument.preset, at);
  for (const [method, ...args] of initial) gate.gain[method](...args);
  if (Number.isFinite(endTime)) sentinel.stop(endTime);
  let releaseLevel = 1, stoppedAt = Infinity, stoppedLevel = 1;
  function levelAt(time) {
    if (time >= stoppedAt) return stoppedLevel * Math.max(0, 1 - (time - stoppedAt) / 0.01);
    if (time >= released) {
      const elapsed = time - released, tail = gated ? timing.release : 0.12;
      if (id === 'wavetable') return 0.0001 + (releaseLevel - 0.0001) * Math.exp(-elapsed / Math.max(0.005, tail / 3));
      if (gated) return releaseLevel * (0.0001 / releaseLevel) ** Math.min(1, elapsed / tail);
      return Math.max(0, 1 - elapsed / tail);
    }
    const fraction = Math.max(0, Math.min(1, (time - at) / timing.attack));
    return !gated ? 1 : id === 'wavetable' ? Math.max(0.0001, fraction) : 0.0001 ** (1 - fraction);
  }
  function hold(time, level) {
    if (typeof gate.gain.cancelAndHoldAtTime === 'function') gate.gain.cancelAndHoldAtTime(time);
    else {
      gate.gain.cancelScheduledValues(time);
      // Cancellation removes a future ramp endpoint. Restore its prefix so a
      // scheduled short note still attacks (or releases) up to the hold time.
      if (time >= stoppedAt || (time >= released && !gated)) gate.gain.linearRampToValueAtTime(level, time);
      else if ((time < released && gated && time <= at + timing.attack) || (time >= released && gated && id !== 'wavetable')) {
        gate.gain[id === 'wavetable' ? 'linearRampToValueAtTime' : 'exponentialRampToValueAtTime'](level, time);
      }
    }
    gate.gain.setValueAtTime(level, time);
  }
  return {
    get endTime() { return endTime; }, ended,
    release(time) {
      if (done || id === 'drums' || time >= released || time >= endTime) return;
      const when = Math.max(at, time), level = levelAt(when);
      hold(when, level); released = when; releaseLevel = level;
      const tail = gated ? timing.release : 0.12;
      if (id === 'wavetable') gate.gain.setTargetAtTime(0.0001, released, Math.max(0.005, tail / 3));
      else if (gated) gate.gain.exponentialRampToValueAtTime(0.0001, released + tail);
      else gate.gain.linearRampToValueAtTime(0, released + tail);
      finish(released + tail + (id === 'wavetable' ? 0.05 : 0.01));
    },
    stop(time) {
      if (done) return;
      const when = Math.max(at, time), level = levelAt(when);
      hold(when, level); stoppedAt = when; stoppedLevel = level;
      gate.gain.linearRampToValueAtTime(0, when + 0.01); finish(when + 0.01);
    },
  };
}
export function createVoicePool() {
  const tracks = new Map();
  return {
    add(trackId, voice, at) {
      const voices = (tracks.get(trackId) || []).filter((v) => v.endTime > at);
      while (voices.length >= 32) voices.shift().stop(at);
      voices.push(voice); tracks.set(trackId, voices);
      voice.ended.then(() => { const list = tracks.get(trackId); if (list) tracks.set(trackId, list.filter((v) => v !== voice)); });
      return voice;
    },
    stop(at) { for (const list of tracks.values()) for (const v of list) v.stop(at); tracks.clear(); },
  };
}
