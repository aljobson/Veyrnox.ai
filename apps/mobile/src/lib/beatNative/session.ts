// N0 dev session: eight tracks on the shared beat engine over a native context, plus a pad hit with a latency readout.
// Pure of React and of native code: the clock, timers and heap probe are injected, so Jest drives it with a fake context.
import type { BeatEngine, BeatTrack } from './shared';

export const N0_FLAG = 'EXPO_PUBLIC_DEV_N0_BEAT_SPIKE';
export const n0Enabled = (value: string | undefined): boolean => value === '1';

/** The plan's pass line for pad to sound (docs/mobile/MUSIC-PLAN-2026-11-18.md, Spike B1). */
export const N0_MAX_PAD_MS = 100;
export const N0_PLAY_SECONDS = 300;
const BPM = 92;
const STEPS = 16;
const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;
/** A tick this late means the JS thread was blocked long enough to risk a gap in scheduling. */
const STALL_MS = 250;

type Note = { step: number; pitch: number; length: number };
export type TrackDef = { track: BeatTrack; gated: boolean; notes: Note[] };

const every = (from: number, to: number, by: number, pitch: number, length: number): Note[] => {
    const out: Note[] = [];
    for (let step = from; step < to; step += by) out.push({ step, pitch, length });
    return out;
};

// Eight tracks that exercise every voice family the engine builds: drum kits (noise, filters, a wave shaper), bass, piano
// (periodic partials, an organ held note), synth, a plucked-string guitar (delay feedback, wave shaper drive) and a wavetable pad (periodic wave).
export const N0_TRACKS: readonly TrackDef[] = [
    { track: { id: 'n0-kick', instrument: { id: 'drums', preset: '808' }, gain: 0.9, pan: 0 }, gated: false, notes: [...every(0, 16, 8, 36, 1), ...every(10, 11, 1, 36, 1)] },
    { track: { id: 'n0-snare', instrument: { id: 'drums', preset: 'lofi' }, gain: 0.8, pan: 0.1 }, gated: false, notes: every(4, 16, 8, 38, 1) },
    { track: { id: 'n0-hat', instrument: { id: 'drums', preset: 'acoustic' }, gain: 0.6, pan: -0.2 }, gated: false, notes: every(0, 16, 2, 42, 1) },
    { track: { id: 'n0-bass', instrument: { id: 'bass', preset: 'sub' }, gain: 0.8, pan: 0 }, gated: true, notes: [{ step: 0, pitch: 36, length: 6 }, { step: 8, pitch: 41, length: 6 }] },
    { track: { id: 'n0-keys', instrument: { id: 'piano', preset: 'electric' }, gain: 0.7, pan: -0.3 }, gated: false, notes: [{ step: 0, pitch: 60, length: 4 }, { step: 4, pitch: 64, length: 4 }, { step: 8, pitch: 67, length: 4 }, { step: 12, pitch: 64, length: 4 }] },
    { track: { id: 'n0-guitar', instrument: { id: 'guitar', preset: 'crunch' }, gain: 0.5, pan: 0.3 }, gated: false, notes: [{ step: 0, pitch: 52, length: 4 }, { step: 8, pitch: 55, length: 4 }] },
    { track: { id: 'n0-lead', instrument: { id: 'synth', preset: 'lead' }, gain: 0.5, pan: 0.2 }, gated: true, notes: every(2, 16, 4, 72, 2) },
    { track: { id: 'n0-pad', instrument: { id: 'wavetable', preset: 'pad' }, gain: 0.5, pan: 0 }, gated: true, notes: [{ step: 0, pitch: 55, length: 16 }] },
];

export type PadReading = { jsMs: number; baseMs: number; outMs: number; estimateMs: number; pass: boolean };
export type Stats = { tracks: number; seconds: number; notes: number; stalls: number; ctxState: string; audioTime: number; heapMb: number | null };

export type SessionDeps = {
    engine: BeatEngine;
    /** Wall clock in milliseconds (performance.now). */
    wall: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    /** Heap in bytes, or null when the runtime cannot say (Hermes: HermesInternal.getInstrumentedStats). */
    heapBytes: () => number | null;
    defs?: readonly TrackDef[];
};

export function hermesHeapBytes(scope: { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } } = globalThis as never): number | null {
    const stats = scope.HermesInternal?.getInstrumentedStats?.();
    const bytes = stats?.js_heapSize ?? stats?.js_allocatedBytes;
    return typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null;
}

export function createSession({ engine, wall, setTimer, clearTimer, heapBytes, defs = N0_TRACKS }: SessionDeps) {
    const stepSeconds = 60 / BPM / 4;
    let timer: unknown = null;
    let cursorStep = 0;
    let nextTime = 0;
    let startedAt = 0;
    let lastTick = 0;
    let notes = 0;
    let stalls = 0;

    function scheduleStep(step: number, at: number) {
        for (const def of defs) {
            for (const note of def.notes) {
                if (note.step !== step) continue;
                const voice = engine.playMidi(def.track, note.pitch, 96, at);
                notes += 1;
                if (def.gated) voice.release(at + note.length * stepSeconds);
            }
        }
    }

    function tick() {
        const now = wall();
        if (lastTick && now - lastTick > STALL_MS) stalls += 1;
        lastTick = now;
        const horizon = engine.now() + LOOKAHEAD_S;
        while (nextTime < horizon) {
            scheduleStep(cursorStep % STEPS, nextTime);
            cursorStep += 1;
            nextTime += stepSeconds;
        }
        timer = setTimer(tick, TICK_MS);
    }

    return {
        async start() {
            if (timer !== null) return;
            await engine.resume();
            startedAt = wall();
            lastTick = 0;
            cursorStep = 0;
            nextTime = engine.now() + 0.1;
            tick();
        },
        stop() {
            if (timer !== null) clearTimer(timer);
            timer = null;
        },
        async close() {
            this.stop();
            await engine.close();
        },
        /** One pad hit. `jsMs` is the time the call took on the JS thread; the platform's reported output latency is added. It is an estimate, not a loopback. */
        pad(): PadReading {
            const before = wall();
            engine.playPad('kick', 110, engine.now(), undefined, '808');
            const jsMs = wall() - before;
            const ctx = engine.context as { baseLatency?: number; outputLatency?: number };
            const baseMs = (ctx.baseLatency ?? 0) * 1000;
            const outMs = (ctx.outputLatency ?? 0) * 1000;
            const estimateMs = jsMs + baseMs + outMs;
            return { jsMs, baseMs, outMs, estimateMs, pass: estimateMs <= N0_MAX_PAD_MS };
        },
        stats(): Stats {
            const bytes = heapBytes();
            return {
                tracks: timer === null ? 0 : defs.length,
                seconds: timer === null ? 0 : Math.floor((wall() - startedAt) / 1000),
                notes, stalls, ctxState: engine.context.state, audioTime: engine.now(),
                heapMb: bytes === null ? null : Math.round(bytes / 1048576),
            };
        },
    };
}

export type Session = ReturnType<typeof createSession>;
