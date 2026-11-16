import { buildMaster, buildSendBuses, buildTrackStrip } from './beatMixGraph.js';
import { startVoice, createVoicePool } from './beatVoices.js';
import { makeNoise, playEvent } from '../instrumentEngine.js';

import { beatOutput, connectTrackChannel } from './beatOutput.js';
export { beatOutput, connectTrackChannel } from './beatOutput.js';
export function createBeatEngine() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw new Error("Sound isn't available in this browser");
  const context = new Audio();
  const master = beatOutput(context);
  const noise = makeNoise(context);
  let sequence = 0;
  const runs = new Set();
  const timers = new Set();
  const pool = createVoicePool();
  const live = { bus: master, channels: new Map() };
  return {
    context, master, live,
    now: () => context.currentTime,
    resume: () => context.resume(),
    startRun(doc, { automationActive = doc?.view === 'song', onError } = {}) {
      const bus = context.createGain();
      const section = doc?.master ? buildMaster(context, doc, { destination: bus, onError }) : null;
      bus.connect(section ? context.destination : master);
      const mix = doc ? section || { input: bus, output: master.outputNode, ...buildSendBuses(context, doc, bus, { onError }) } : null;
      const run = { id: ++sequence, bus, master: section, mix, doc, automationActive, onError, channels: new Map(), voices: new Set() };
      if (doc) for (const track of doc.tracks) run.channels.set(track.id, buildTrackStrip(context, mix, track, { doc, automationActive, onError }));
      runs.add(run);
      return run;
    },
    trackChannel(run, trackId, gain = 1, pan = 0) {
      if (!run.channels.has(trackId) && run.mix) {
        const track = run.doc.tracks.find(t => t.id === trackId);
        if (track) {
          run.mix.ensureSends(run.doc);
          run.channels.set(trackId, buildTrackStrip(context, run.mix, track, { doc: run.doc, automationActive: run.automationActive, onError: run.onError }));
        }
      }
      if (!run.channels.has(trackId)) run.channels.set(trackId, { ...connectTrackChannel(context, run.bus, gain, pan), gain, pan });
      return run.channels.get(trackId);
    },
    setTrackMix(run, trackId, gain, pan, doc = run.doc) {
      if (run.mix && doc) {
        run.doc = doc; run.mix.setMaster(doc.master, context.currentTime);
        const track = doc.tracks.find(t => t.id === trackId);
        const strip = track && this.trackChannel(run, trackId);
        if (strip && track) { strip.update(track, doc, context.currentTime); return strip.input; }
      }
      const channel = this.trackChannel(run, trackId, gain, pan);
      // Avoid rescheduling the target every animation frame when nothing changed.
      if (channel.gain !== gain) channel.input.gain.setTargetAtTime(gain, context.currentTime, 0.01);
      if (channel.pan !== pan) channel.panner.pan.setTargetAtTime(pan, context.currentTime, 0.01);
      channel.gain = gain; channel.pan = pan;
      return channel.input;
    },
    meterTap(trackId) {
      const run = [...runs].at(-1);
      return trackId === 'master' ? run?.mix?.output || master.outputNode : run?.channels.get(trackId)?.meterTap || live.channels.get(trackId)?.panner;
    },
    stopRun(run) {
      if (!run || !runs.has(run)) return;
      for (const voice of run.voices) voice.stop(context.currentTime);
      run.bus.gain.cancelScheduledValues(context.currentTime);
      run.bus.gain.setValueAtTime(run.bus.gain.value, context.currentTime);
      run.bus.gain.linearRampToValueAtTime(0, context.currentTime + 0.01);
      const timer = setTimeout(() => { run.bus.disconnect(); run.mix?.dispose(); for (const strip of run.channels.values()) strip.dispose?.(); runs.delete(run); timers.delete(timer); }, 60);
      timers.add(timer);
    },
    playMidi(track, pitch, velocity, at, run = live, gain = track.gain) {
      const destination = this.setTrackMix(run, track.id, gain, track.pan);
      const voice = pool.add(track.id, startVoice(context, destination, noise, track.instrument, pitch, velocity, at), at);
      run.voices?.add(voice); voice.ended.then(() => run.voices?.delete(voice));
      return voice;
    },
    playPad(pad, velocity, at, destination = master, kit = '808') {
      playEvent(context, destination, noise, 'drums', kit, { value: pad, vel: velocity }, at);
    },
    click(at, accent, destination) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = accent ? 1500 : 1000;
      gain.gain.setValueAtTime(0.12, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      oscillator.connect(gain).connect(destination);
      oscillator.start(at); oscillator.stop(at + 0.05);
    },
    close() {
      pool.stop(context.currentTime);
      for (const timer of timers) clearTimeout(timer);
      for (const run of runs) { run.bus.disconnect(); run.mix?.dispose(); for (const strip of run.channels.values()) strip.dispose?.(); }
      runs.clear();
      return context.close();
    },
  };
}
