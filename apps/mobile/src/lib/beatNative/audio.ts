// The one audio interface the beat screens talk to. N1 has a single implementation (the N0 adapter over the shared web engine);
// if the N0 device gate fails, swap `createBeatAudio` for another implementation of `BeatAudio` and no screen changes.
import { createNativeBeatEngine, loadNativeContext, type NativeContextCtor } from './nativeContext';
import type { BeatEngine, EngineContext } from './shared';
import { createMixRun } from './mixRun';
import { eventsAtStep, eventTime, loopSteps, stepSeconds, type BeatDoc, type PadId } from './doc';

export type TrackMix = { gain: number; pan: number };
export interface BeatAudio {
    /** Start looping the document. Edits made while it plays are heard from the next step (`getDoc` is read each tick). */
    play(getDoc: () => BeatDoc, onStep?: (step: number) => void, onError?: (error: unknown) => void): Promise<void>;
    readonly context: EngineContext;
    meterTap(trackId: string | 'master'): unknown | null;
    stop(): void;
    isPlaying(): boolean;
    hitPad(pad: PadId, kit: string, velocity?: number): void;
    /** Fader and pan for one track; mute and solo are folded into `gain` by the caller (see `audibleGain`). */
    setTrackMix(trackId: string, mix: TrackMix): void;
    close(): Promise<void>;
}

const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;
const PAD_VELOCITY = 100 / 127;

export type AudioDeps = {
    engine: BeatEngine;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
};

export function createBeatAudioFromEngine({ engine, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = h => clearTimeout(h as never) }: AudioDeps): BeatAudio {
    const mixRun = createMixRun(engine);
    let playing = false;
    let timer: unknown = null;
    let cursor = 0;
    let nextTime = 0;
    let getDoc: (() => BeatDoc) | null = null;
    let onStep: ((step: number) => void) | undefined;
    let onError: ((error: unknown) => void) | undefined;
    function stop() {
        playing = false; getDoc = null;
        if (timer !== null) clearTimer(timer);
        timer = null;
        mixRun.stop();
    }
    function fail(error: unknown) {
        try { stop(); } catch { /* Preserve the original engine error. */ }
        try { onError?.(error); } catch { /* A consumer callback cannot escape the timer. */ }
    }

    function tick() {
        timer = null;
        if (!playing) return;
        try {
            const doc = getDoc?.();
            if (!doc) return;
            mixRun.sync(doc);
            const horizon = engine.now() + LOOKAHEAD_S;
            while (nextTime < horizon) {
                const step = cursor % loopSteps(doc);
                const seconds = stepSeconds(doc.tempo.bpm);
                mixRun.schedule(doc, step * seconds, (step + 1) * seconds, nextTime);
                for (const event of eventsAtStep(doc, step)) {
                    const at = eventTime(nextTime, step, doc.tempo.bpm, doc.swing);
                    const destination = mixRun.destination(event.trackId, doc, at);
                    engine.playPad(event.pad, event.velocity, at, destination, doc.tracks.find(t => t.id === event.trackId)?.kit);
                }
                onStep?.(step);
                if (!playing) return;
                cursor += 1;
                nextTime += seconds;
            }
            timer = setTimer(tick, TICK_MS);
        } catch (error) { fail(error); }
    }

    return {
        context: engine.context,
        meterTap: trackId => playing ? mixRun.meterTap(trackId) : null,
        async play(read, step, error) {
            if (playing) return;
            await engine.resume();
            getDoc = read; onStep = step; onError = error; cursor = 0; nextTime = engine.now() + 0.1;
            playing = true;
            tick();
        },
        stop,
        isPlaying: () => playing,
        hitPad(pad, kit, velocity = PAD_VELOCITY) {
            void engine.resume();
            engine.playPad(pad, velocity, engine.now(), undefined, kit);
        },
        setTrackMix(_trackId, _mix) {
            if (playing && getDoc) { try { mixRun.sync(getDoc()); } catch (error) { fail(error); } }
        },
        async close() { try { stop(); } finally { await engine.close(); } },
    };
}

/** The shipping implementation: the shared web engine on `react-native-audio-api` (docs/mobile/spikes/N0-NATIVE-ENGINE.md). */
export function createBeatAudio(Context: NativeContextCtor = loadNativeContext()): BeatAudio {
    return createBeatAudioFromEngine({ engine: createNativeBeatEngine({ Context }).engine });
}
