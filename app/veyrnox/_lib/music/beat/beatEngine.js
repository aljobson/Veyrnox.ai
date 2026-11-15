import { makeNoise, playEvent } from '../instrumentEngine.js';

// Shared output topology for live playback and offline export.
export function beatOutput(context) {
  const master = context.createGain();
  master.gain.value = 0.8;
  const compressor = context.createDynamicsCompressor();
  master.connect(compressor).connect(context.destination);
  return master;
}
export function connectTrackChannel(context, destination, gain = 1, pan = 0) {
  const input = context.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  input.gain.value = gain;
  const panner = context.createStereoPanner();
  panner.pan.value = pan;
  input.connect(panner).connect(destination);
  return { input, panner };
}
export function createBeatEngine() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw new Error("Sound isn't available in this browser");
  const context = new Audio();
  const master = beatOutput(context);
  const noise = makeNoise(context);
  let sequence = 0;
  const runs = new Set();
  const timers = new Set();
  return {
    context, master,
    now: () => context.currentTime,
    resume: () => context.resume(),
    startRun() {
      const bus = context.createGain();
      bus.connect(master);
      const run = { id: ++sequence, bus, channels: new Map() };
      runs.add(run);
      return run;
    },
    trackChannel(run, trackId, gain = 1, pan = 0) {
      if (!run.channels.has(trackId)) run.channels.set(trackId, { ...connectTrackChannel(context, run.bus, gain, pan), gain, pan });
      return run.channels.get(trackId);
    },
    setTrackMix(run, trackId, gain, pan) {
      const channel = this.trackChannel(run, trackId, gain, pan);
      // Avoid rescheduling the target every animation frame when nothing changed.
      if (channel.gain !== gain) channel.input.gain.setTargetAtTime(gain, context.currentTime, 0.01);
      if (channel.pan !== pan) channel.panner.pan.setTargetAtTime(pan, context.currentTime, 0.01);
      channel.gain = gain; channel.pan = pan;
      return channel.input;
    },
    stopRun(run) {
      if (!run || !runs.has(run)) return;
      run.bus.gain.cancelScheduledValues(context.currentTime);
      run.bus.gain.setValueAtTime(run.bus.gain.value, context.currentTime);
      run.bus.gain.linearRampToValueAtTime(0, context.currentTime + 0.01);
      const timer = setTimeout(() => { run.bus.disconnect(); runs.delete(run); timers.delete(timer); }, 60);
      timers.add(timer);
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
      for (const timer of timers) clearTimeout(timer);
      for (const run of runs) run.bus.disconnect();
      runs.clear();
      return context.close();
    },
  };
}
