// Pure data and helpers for the Music instrument surface: no Web Audio here, so the node tests can run it.

export const INSTRUMENT_IDS = Object.freeze(['piano', 'guitar', 'drums', 'bass', 'synth']);
export const MAX_TAKE_SECONDS = 60;
export const MAX_TAKE_EVENTS = 600;
export const SAMPLE_RATE = 44100;

const NOTE_NAMES = Object.freeze(['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);

export const PRESETS = Object.freeze({
  piano: Object.freeze([
    Object.freeze({ id: 'grand', label: 'Grand piano', hint: 'Warm, long decay', decay: 2.2, bright: 0.5, tremolo: 0 }),
    Object.freeze({ id: 'electric', label: 'Electric piano', hint: 'Soft bell with tremolo', decay: 1.6, bright: 0.3, tremolo: 5 }),
    Object.freeze({ id: 'musicbox', label: 'Music box', hint: 'High, short, glassy', decay: 0.9, bright: 0.9, tremolo: 0 }),
    Object.freeze({ id: 'organ', label: 'Organ', hint: 'Held for as long as you press', decay: 0, bright: 0.7, tremolo: 0 }),
  ]),
  guitar: Object.freeze([
    Object.freeze({ id: 'nylon', label: 'Nylon acoustic', hint: 'Soft and round', sustain: 0.985, tone: 2600, drive: 0 }),
    Object.freeze({ id: 'steel', label: 'Steel acoustic', hint: 'Bright strum', sustain: 0.992, tone: 6200, drive: 0 }),
    Object.freeze({ id: 'clean', label: 'Clean electric', hint: 'Glassy and open', sustain: 0.994, tone: 4200, drive: 0.1 }),
    Object.freeze({ id: 'crunch', label: 'Crunch', hint: 'Driven rock rhythm', sustain: 0.994, tone: 3800, drive: 0.75 }),
  ]),
  drums: Object.freeze([
    Object.freeze({ id: 'acoustic', label: 'Acoustic kit', hint: 'Natural room kit', pitch: 1, decay: 1, snap: 0.5 }),
    Object.freeze({ id: '808', label: '808 kit', hint: 'Long sub kick, tight hats', pitch: 0.75, decay: 1.8, snap: 0.3 }),
    Object.freeze({ id: 'lofi', label: 'Lo-fi kit', hint: 'Dusty and soft', pitch: 0.9, decay: 0.8, snap: 0.2 }),
  ]),
  bass: Object.freeze([
    Object.freeze({ id: 'sub', label: 'Sub bass', hint: 'Deep sine', wave: 'sine', cutoff: 500, decay: 0.9 }),
    Object.freeze({ id: 'pluck', label: 'Pluck bass', hint: 'Short and punchy', wave: 'sawtooth', cutoff: 900, decay: 0.35 }),
    Object.freeze({ id: 'acid', label: 'Acid bass', hint: 'Squelchy square', wave: 'square', cutoff: 1800, decay: 0.5 }),
  ]),
  synth: Object.freeze([
    Object.freeze({ id: 'lead', label: 'Bright lead', hint: 'Cutting saw', wave: 'sawtooth', cutoff: 5200, attack: 0.01, release: 0.25 }),
    Object.freeze({ id: 'pad', label: 'Warm pad', hint: 'Slow swell', wave: 'triangle', cutoff: 2200, attack: 0.35, release: 1.1 }),
    Object.freeze({ id: 'pluck', label: 'Synth pluck', hint: 'Quick arpeggio voice', wave: 'square', cutoff: 3200, attack: 0.004, release: 0.18 }),
  ]),
});

export const INSTRUMENTS = Object.freeze({
  piano: Object.freeze({ id: 'piano', label: 'Piano & keys', surface: 'keys', low: 48, octaves: 2, glyph: '🎹' }),
  guitar: Object.freeze({ id: 'guitar', label: 'Guitar', surface: 'strings', glyph: '🎸' }),
  drums: Object.freeze({ id: 'drums', label: 'Drums', surface: 'pads', glyph: '🥁' }),
  bass: Object.freeze({ id: 'bass', label: 'Bass', surface: 'keys', low: 28, octaves: 2, glyph: '🪕' }),
  synth: Object.freeze({ id: 'synth', label: 'Synth', surface: 'keys', low: 60, octaves: 2, glyph: '🎛️' }),
});

// Open strings low to high: E2 A2 D3 G3 B3 E4.
export const GUITAR_STRINGS = Object.freeze([40, 45, 50, 55, 59, 64]);
export const GUITAR_FRETS = 5;
// Fret per string (-1 = muted) for the one-tap strum chords.
export const GUITAR_CHORDS = Object.freeze([
  Object.freeze({ id: 'Am', label: 'Am', frets: Object.freeze([-1, 0, 2, 2, 1, 0]) }),
  Object.freeze({ id: 'C', label: 'C', frets: Object.freeze([-1, 3, 2, 0, 1, 0]) }),
  Object.freeze({ id: 'G', label: 'G', frets: Object.freeze([3, 2, 0, 0, 0, 3]) }),
  Object.freeze({ id: 'Em', label: 'Em', frets: Object.freeze([0, 2, 2, 0, 0, 0]) }),
  Object.freeze({ id: 'D', label: 'D', frets: Object.freeze([-1, -1, 0, 2, 3, 2]) }),
  Object.freeze({ id: 'F', label: 'F', frets: Object.freeze([1, 3, 3, 2, 1, 1]) }),
]);

export const DRUM_PADS = Object.freeze([
  Object.freeze({ id: 'kick', label: 'Kick', key: 'a' }),
  Object.freeze({ id: 'snare', label: 'Snare', key: 's' }),
  Object.freeze({ id: 'hat', label: 'Hi-hat', key: 'd' }),
  Object.freeze({ id: 'openhat', label: 'Open hat', key: 'f' }),
  Object.freeze({ id: 'clap', label: 'Clap', key: 'j' }),
  Object.freeze({ id: 'tom', label: 'Tom', key: 'k' }),
  Object.freeze({ id: 'rim', label: 'Rim', key: 'l' }),
  Object.freeze({ id: 'crash', label: 'Crash', key: ';' }),
]);

export function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

export function noteLabel(note) {
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

export function isBlackKey(note) {
  return [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
}

export function keyRange(instrumentId, shift = 0) {
  const instrument = INSTRUMENTS[instrumentId];
  if (!instrument || instrument.surface !== 'keys') return [];
  const low = Math.max(12, Math.min(96, instrument.low + shift * 12));
  const count = instrument.octaves * 12 + 1;
  return Array.from({ length: count }, (_, index) => low + index);
}

export function getPreset(instrumentId, presetId) {
  const list = PRESETS[instrumentId];
  if (!list) return null;
  return list.find((preset) => preset.id === presetId) || list[0];
}

export function chordNotes(chord) {
  return chord.frets.flatMap((fret, string) => (fret < 0 ? [] : [{ string, fret, note: GUITAR_STRINGS[string] + fret }]));
}

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

/** One recorded gesture. `value` is a MIDI note for keys/strings, or a pad id for drums. */
export function normalizeTakeEvent(raw, instrumentId) {
  if (!raw || typeof raw !== 'object' || !INSTRUMENT_IDS.includes(instrumentId)) return null;
  const at = clamp(raw.at, 0, MAX_TAKE_SECONDS, NaN);
  if (!Number.isFinite(at)) return null;
  const dur = clamp(raw.dur, 0.05, 8, 0.4);
  const vel = clamp(raw.vel, 0.05, 1, 0.8);
  if (instrumentId === 'drums') {
    return DRUM_PADS.some((pad) => pad.id === raw.value) ? { at, dur, vel, value: raw.value } : null;
  }
  const note = Math.round(clamp(raw.value, 24, 108, NaN));
  return Number.isFinite(note) ? { at, dur, vel, value: note } : null;
}

export function normalizeTake(raw) {
  if (!raw || typeof raw !== 'object' || !INSTRUMENT_IDS.includes(raw.instrument)) return null;
  const preset = getPreset(raw.instrument, raw.preset);
  const events = (Array.isArray(raw.events) ? raw.events : [])
    .slice(0, MAX_TAKE_EVENTS)
    .map((event) => normalizeTakeEvent(event, raw.instrument))
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  if (!events.length) return null;
  const last = events.reduce((max, event) => Math.max(max, event.at + event.dur), 0);
  return {
    instrument: raw.instrument,
    preset: preset.id,
    events,
    length: Math.min(MAX_TAKE_SECONDS, Math.ceil((last + 0.6) * 10) / 10),
  };
}

/** Cut a rendered mono buffer to [start, end] seconds with a short fade so the clip does not click. */
export function trimSamples(samples, sampleRate, startSeconds, endSeconds) {
  const total = samples.length;
  const from = Math.max(0, Math.min(total, Math.floor(clamp(startSeconds, 0, 3600, 0) * sampleRate)));
  const to = Math.max(from, Math.min(total, Math.floor(clamp(endSeconds, 0, 3600, total / sampleRate) * sampleRate)));
  const out = Float32Array.from(samples.subarray(from, to));
  const fade = Math.min(Math.floor(sampleRate * 0.008), Math.floor(out.length / 2));
  for (let index = 0; index < fade; index += 1) {
    const gain = index / fade;
    out[index] *= gain;
    out[out.length - 1 - index] *= gain;
  }
  return out;
}

/** 16-bit PCM mono WAV. Returns an ArrayBuffer. */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, bytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return buffer;
}

export function sampleFileName(take, now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `veyrnox-${take.instrument}-${take.preset}-${stamp}.wav`;
}
