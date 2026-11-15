export const WAVETABLE_PRESETS = Object.freeze({
  glass: { label: 'Glass keys', tableA: 'pure', tableB: 'bright', morph: 0.28, cutoff: 7600, resonance: 1.4, attack: 0.01, release: 0.38, lfoRate: 0.35, lfoDepth: 0.05 },
  pad: { label: 'Warm pad', tableA: 'warm', tableB: 'hollow', morph: 0.58, cutoff: 3200, resonance: 2.1, attack: 0.42, release: 1.25, lfoRate: 0.22, lfoDepth: 0.18 },
  bass: { label: 'Pulse bass', tableA: 'bright', tableB: 'hollow', morph: 0.72, cutoff: 980, resonance: 5.5, attack: 0.005, release: 0.18, lfoRate: 2.4, lfoDepth: 0.08 },
});
const TABLES = { pure: [0, 1], warm: [0, 1, 0.42, 0.18, 0.08, 0.04], bright: [0, 1, 0.72, 0.5, 0.34, 0.24, 0.17, 0.12], hollow: [0, 1, 0, 0.42, 0, 0.2, 0, 0.1] };
// Port of MusicStudioMidi's two-table voice, including its filter LFO.
// The enclosing voice owns the amplitude envelope and all source lifetimes.
export function wavetableNodes(context, out, preset, frequency, at) {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.setValueAtTime(preset.cutoff, at); filter.Q.setValueAtTime(preset.resonance, at);
  filter.connect(out);
  for (const [table, level] of [[preset.tableA, 1 - preset.morph], [preset.tableB, preset.morph]]) {
    const oscillator = context.createOscillator(), gain = context.createGain(), values = TABLES[table];
    oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array(values.length), new Float32Array(values)));
    oscillator.frequency.setValueAtTime(frequency, at); gain.gain.setValueAtTime(level, at);
    oscillator.connect(gain).connect(filter); oscillator.start(at);
  }
  const lfo = context.createOscillator(), depth = context.createGain();
  lfo.frequency.setValueAtTime(preset.lfoRate, at); depth.gain.setValueAtTime(preset.cutoff * preset.lfoDepth, at);
  lfo.connect(depth).connect(filter.frequency); lfo.start(at);
}
