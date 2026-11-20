// The one audio interface the beat screens talk to. N1 has a single implementation (the N0 adapter over the shared web engine);
// if the N0 device gate fails, swap `createBeatAudio` for another implementation of `BeatAudio` and no screen changes.
import { createNativeBeatEngine, loadNativeContext, type NativeContextCtor } from './nativeContext';
import type { BeatEngine, BeatVoice, EngineContext, Run } from './shared';
import { DRUM_KITS, audibleGain, eventsAtStep, eventTime, loopSteps, stepSeconds, type BeatDoc, type PadId } from './doc';

import { midiNoteOnsInWindow, midiTracks, type Instrument, type MidiSoundTrack } from './midi';

export type TrackMix = { gain: number; pan: number };
export interface BeatAudio {
    /** Start looping the document. Edits made while it plays are heard from the next step (`getDoc` is read each tick). */
    play(getDoc: () => BeatDoc | undefined, onStep?: (step: number) => void): Promise<void>;
    stop(): void;
    isPlaying(): boolean;
    hitPad(pad: PadId, kit: string, velocity?: number): void;
    /** Fader and pan for one track; mute and solo are folded into `gain` by the caller (see `audibleGain`). */
    setTrackMix(trackId: string, mix: TrackMix): void;
    noteOn(key: string, track: MidiSoundTrack, pitch: number, velocity: number): Promise<void>;
    noteOff(key: string): void;
    releaseKeys(): void;
    audition(instrument: Instrument): Promise<void>;
    close(): Promise<void>;
}

export function playRange(doc: BeatDoc): { from: number; to: number } {
    if (doc.view === 'pattern') return { from: 0, to: doc.steps };
    return doc.cycle.on ? { from: doc.cycle.start / 240, to: doc.cycle.end / 240 } : { from: 0, to: loopSteps(doc) };
}

const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;
const MASTER_GAIN = 0.8;
const PAD_VELOCITY = 100 / 127;
type Param = { value: number; setTargetAtTime?: (v: number, at: number, tc: number) => unknown };
type Strip = { input: unknown; gain: Param; pan: Param };
type Ctx = EngineContext & { createGain(): { gain: Param; connect(n: unknown): unknown }; createStereoPanner(): { pan: Param; connect(n: unknown): unknown } };

export type AudioDeps = {
    engine: BeatEngine;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
};

export function createBeatAudioFromEngine({ engine, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = h => clearTimeout(h as never) }: AudioDeps): BeatAudio {
    const ctx = engine.context as Ctx;
    let master: { gain: Param; connect(n: unknown): unknown } | null = null;
    const strips = new Map<string, Strip>();
    const levels = new Map<string, TrackMix>();
    let timer: unknown = null;
    let run: Run | null = null;
    let generation = 0;
    let starting = false;
    let closed = false;
    const keys = new Map<string, { voice?: BeatVoice }>();
    let cursor = 0;
    let nextTime = 0;
    let getDoc: (() => BeatDoc | undefined) | null = null;
    let onStep: ((step: number) => void) | undefined;
    const kitOf = new Map<string, string>();

    const bus = (): { gain: Param; connect(n: unknown): unknown } => {
        if (!master) { master = ctx.createGain(); master.gain.value = MASTER_GAIN; master.connect(ctx.destination); }
        return master;
    };
    const strip = (trackId: string): Strip => {
        let found = strips.get(trackId);
        if (found) return found;
        const gain = ctx.createGain(); const pan = ctx.createStereoPanner();
        const level = levels.get(trackId) ?? { gain: 1, pan: 0 };
        gain.gain.value = level.gain; pan.pan.value = level.pan;
        gain.connect(pan); pan.connect(bus());
        found = { input: gain, gain: gain.gain, pan: pan.pan };
        strips.set(trackId, found);
        return found;
    };

    function syncMidi(doc: BeatDoc) {
        for (const track of midiTracks(doc)) {
            const gain = audibleGain(doc, track);
            if (run) engine.setTrackMix(run, track.id, gain, track.pan);
            engine.setTrackMix(engine.live, track.id, gain, track.pan);
        }
    }
    function tick() {
        if (!getDoc || !run) return;
        const current = getDoc();
        if (current) syncMidi(current);
        const horizon = engine.now() + LOOKAHEAD_S;
        while (nextTime < horizon) {
            const doc = getDoc();
            // The beat can leave the store while it plays (deleted, account reset): stop scheduling instead of throwing in a timer.
            if (!doc) { timer = null; return; }
            const { from, to } = playRange(doc);
            const step = from + (cursor % (to - from));
            for (const track of doc.tracks) {
                levels.set(track.id, { gain: audibleGain(doc, track), pan: track.pan });
                kitOf.set(track.id, track.kit ?? DRUM_KITS[0].id);
            }
            for (const event of eventsAtStep(doc, step)) {
                const s = strip(event.trackId);
                s.gain.value = levels.get(event.trackId)?.gain ?? 1;
                s.pan.value = levels.get(event.trackId)?.pan ?? 0;
                engine.playPad(event.pad, event.velocity, eventTime(nextTime, step, doc.tempo.bpm, doc.swing) , s.input, kitOf.get(event.trackId));
            }
            const stepStart = step * stepSeconds(doc.tempo.bpm);
            for (const event of midiNoteOnsInWindow(doc, stepStart, stepStart + stepSeconds(doc.tempo.bpm))) {
                const track = midiTracks(doc).find(t => t.id === event.trackId);
                if (!track) continue;
                const at = nextTime + event.songTimeSec - stepStart;
                engine.playMidi(track, event.pitch, event.velocity, at, run, audibleGain(doc, track)).release(at + event.durationSec);
            }
            onStep?.(step);
            cursor += 1;
            nextTime += stepSeconds(doc.tempo.bpm);
        }
        timer = setTimer(tick, TICK_MS);
    }

    return {
        async play(read, step) {
            if (timer !== null || starting || closed) return;
            const token = ++generation;
            starting = true;
            try { await engine.resume(); } finally { if (token === generation) starting = false; }
            if (token !== generation || closed) return;
            run = engine.startRun(null);
            getDoc = read; onStep = step; cursor = 0; nextTime = engine.now() + 0.1;
            tick();
        },
        stop() {
            generation++; starting = false;
            if (timer !== null) clearTimer(timer);
            timer = null;
            if (run) engine.stopRun(run);
            run = null;
        },
        isPlaying: () => timer !== null,
        hitPad(pad, kit, velocity = PAD_VELOCITY) {
            void engine.resume();
            engine.playPad(pad, velocity, engine.now(), bus(), kit);
        },
        setTrackMix(trackId, mix) {
            levels.set(trackId, mix);
            const s = strips.get(trackId);
            if (s) { s.gain.value = mix.gain; s.pan.value = mix.pan; }
            const doc = getDoc?.();
            if (doc) syncMidi(doc);
            if (run) engine.setTrackMix(run, trackId, mix.gain, mix.pan);
            engine.setTrackMix(engine.live, trackId, mix.gain, mix.pan);
        },
        async noteOn(key, track, pitch, velocity) {
            if (closed || keys.has(key) || pitch < 21 || pitch > 108) return;
            const marker: { voice?: BeatVoice } = {};
            keys.set(key, marker);
            try {
                await engine.resume();
                if (closed || keys.get(key) !== marker) return;
                const doc = getDoc?.(), current = doc && midiTracks(doc).find(t => t.id === track.id);
                const sound = current ?? track;
                const mix = current && doc ? { gain: audibleGain(doc, current), pan: current.pan } : levels.get(track.id) ?? track;
                engine.setTrackMix(engine.live, track.id, mix.gain, mix.pan);
                marker.voice = engine.playMidi({ ...sound, pan: mix.pan }, pitch, velocity, engine.now(), engine.live, mix.gain);
            } catch (error) { if (keys.get(key) === marker) keys.delete(key); throw error; }
        },
        noteOff(key) { const held = keys.get(key); keys.delete(key); held?.voice?.release(engine.now()); },
        releaseKeys() { for (const key of keys.keys()) this.noteOff(key); },
        async audition(instrument) {
            if (closed) return;
            await engine.resume();
            if (closed) return;
            const track = { id: 'native-midi-audition', instrument, gain: 1, pan: 0 };
            for (const [index, pitch] of (instrument.id === 'drums' ? [36, 38, 42, 46] : [48, 52, 55, 60]).entries()) {
                const at = engine.now() + index * 0.18;
                engine.playMidi(track, pitch, 100, at, engine.live).release(at + 0.25);
            }
        },
        async close() { closed = true; this.stop(); this.releaseKeys(); await engine.close(); },
    };
}

/** The shipping implementation: the shared web engine on `react-native-audio-api` (docs/mobile/spikes/N0-NATIVE-ENGINE.md). */
export function createBeatAudio(Context: NativeContextCtor = loadNativeContext()): BeatAudio {
    return createBeatAudioFromEngine({ engine: createNativeBeatEngine({ Context }).engine });
}
