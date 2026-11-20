// The one audio interface the beat screens talk to. N1 has a single implementation (the N0 adapter over the shared web engine);
// if the N0 device gate fails, swap `createBeatAudio` for another implementation of `BeatAudio` and no screen changes.
import { createNativeBeatEngine, loadNativeContext, type NativeContextCtor } from './nativeContext';
import type { BeatEngine, EngineContext } from './shared';
import { DRUM_KITS, audibleGain, eventsAtStep, eventTime, loopSteps, stepSeconds, type BeatDoc, type PadId } from './doc';

export type TrackMix = { gain: number; pan: number };
export interface BeatAudio {
    /** Start looping the document. Edits made while it plays are heard from the next step (`getDoc` is read each tick). */
    play(getDoc: () => BeatDoc, onStep?: (step: number) => void): Promise<void>;
    stop(): void;
    isPlaying(): boolean;
    hitPad(pad: PadId, kit: string, velocity?: number): void;
    /** Fader and pan for one track; mute and solo are folded into `gain` by the caller (see `audibleGain`). */
    setTrackMix(trackId: string, mix: TrackMix): void;
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
    let cursor = 0;
    let nextTime = 0;
    let getDoc: (() => BeatDoc) | null = null;
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

    function tick() {
        if (!getDoc) return;
        const horizon = engine.now() + LOOKAHEAD_S;
        while (nextTime < horizon) {
            const doc = getDoc();
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
            onStep?.(step);
            cursor += 1;
            nextTime += stepSeconds(doc.tempo.bpm);
        }
        timer = setTimer(tick, TICK_MS);
    }

    return {
        async play(read, step) {
            if (timer !== null) return;
            await engine.resume();
            getDoc = read; onStep = step; cursor = 0; nextTime = engine.now() + 0.1;
            tick();
        },
        stop() { if (timer !== null) clearTimer(timer); timer = null; },
        isPlaying: () => timer !== null,
        hitPad(pad, kit, velocity = PAD_VELOCITY) {
            void engine.resume();
            engine.playPad(pad, velocity, engine.now(), bus(), kit);
        },
        setTrackMix(trackId, mix) {
            levels.set(trackId, mix);
            const s = strips.get(trackId);
            if (!s) return;
            s.gain.value = mix.gain; s.pan.value = mix.pan;
        },
        async close() { this.stop(); await engine.close(); },
    };
}

/** The shipping implementation: the shared web engine on `react-native-audio-api` (docs/mobile/spikes/N0-NATIVE-ENGINE.md). */
export function createBeatAudio(Context: NativeContextCtor = loadNativeContext()): BeatAudio {
    return createBeatAudioFromEngine({ engine: createNativeBeatEngine({ Context }).engine });
}
