// One typed seam over the shared plain-JS instrument modules in ../../lib (Metro watches that folder).
// @ts-ignore the JS files may or may not carry inferred types depending on tsconfig; the casts below fix the shape either way.
import * as data from '../../../../lib/musicInstruments.js';
// @ts-ignore see above
import * as synth from '../../../../lib/musicInstrumentSynth.js';

export type TakeEvent = { at: number; dur: number; vel: number; value: number | string };
export type RawTake = { instrument: string; preset: string; events: TakeEvent[] };
type Preset = { id: string; label: string; hint: string };
type Instrument = { id: string; label: string; surface: 'keys' | 'strings' | 'pads'; glyph: string };
type Chord = { id: string; label: string; frets: number[] };
type Pad = { id: string; label: string };

const d = data as unknown as {
    INSTRUMENT_IDS: string[];
    INSTRUMENTS: Record<string, Instrument>;
    PRESETS: Record<string, Preset[]>;
    GUITAR_STRINGS: number[];
    GUITAR_FRETS: number;
    GUITAR_CHORDS: Chord[];
    DRUM_PADS: Pad[];
    MAX_TAKE_EVENTS: number;
    MAX_TAKE_SECONDS: number;
    keyRange: (instrument: string, shift?: number) => number[];
    isBlackKey: (note: number) => boolean;
    noteLabel: (note: number) => string;
    chordNotes: (chord: Chord) => { string: number; fret: number; note: number }[];
    normalizeTake: (raw: RawTake) => (RawTake & { length: number }) | null;
    trimSamples: (samples: Float32Array, rate: number, start: number, end: number) => Float32Array;
    encodeWav: (samples: Float32Array, rate: number) => ArrayBuffer;
};
const s = synth as unknown as {
    SYNTH_RATE: number;
    renderVoiceWav: (instrument: string, preset: string, value: number | string, vel: number, dur: number) => ArrayBuffer;
    renderTakeSamples: (take: RawTake & { length: number }) => Float32Array;
};

export const {
    INSTRUMENT_IDS, INSTRUMENTS, PRESETS, GUITAR_STRINGS, GUITAR_FRETS, GUITAR_CHORDS, DRUM_PADS, MAX_TAKE_EVENTS, MAX_TAKE_SECONDS,
    keyRange, isBlackKey, noteLabel, chordNotes, normalizeTake, trimSamples, encodeWav,
} = d;
export const { SYNTH_RATE, renderVoiceWav, renderTakeSamples } = s;
export type { Preset, Chord, Pad };
