// The one audio interface the beat screens talk to. N1 has a single implementation (the N0 adapter over the shared web engine);
// if the N0 device gate fails, swap `createBeatAudio` for another implementation of `BeatAudio` and no screen changes.
import { createRecordingTransport, type PlayRange } from './transport';
import { createTakePlayback, type PlaybackContext } from './takePlayback';
import type { SongWindow } from './takeShared';
import { tickSeconds } from './takeShared';
import { songEnd } from './doc';
import { configureNativeTakeStorage } from './takeShared';
import { type BeatEngine as NativeBeatEngine } from './shared';
import { createMixRun } from './mixRun';
import { createNativeBeatEngine, loadNativeContext, type NativeContextCtor } from './nativeContext';
import type { NativeAssetPort } from './nativeAssets';
import type { BeatEngine, BeatVoice, EngineContext } from './shared';
import { DRUM_KITS, audibleGain, eventsAtStep, eventTime, loopSteps, stepSeconds, type BeatDoc, type PadId } from './doc';

import { midiNoteOnsInWindow, midiTracks, type Instrument, type MidiSoundTrack } from './midi';

export type TrackMix = { gain: number; pan: number };
/** `onError`: an engine error stopped playback. `onEffectError`: an effect the native context cannot build was skipped. */
export type PlayHandlers = { onError?: (error: unknown) => void; onEffectError?: (message: string) => void };
export type BeatPlayOutcome = 'started' | 'cancelled' | 'busy';
export interface BeatAudio {
    recordingEngine?(): NativeBeatEngine;
    playRange?(options: PlayRange): Promise<{ contextStart: number }>;
    /** Start looping the document. Edits made while it plays are heard from the next step (`getDoc` is read each tick). */
    play(getDoc: () => BeatDoc | undefined, onStep?: (step: number) => void, onWindow?: (window: SongWindow) => void, startOffsetSec?: number, handlers?: PlayHandlers): Promise<BeatPlayOutcome>;
    readonly context: EngineContext;
    /** The node a level meter reads (the web engine's meter tap); null while nothing plays. */
    meterTap(trackId: string | 'master'): unknown | null;
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
    assets?: NativeAssetPort;
    onAssetError?: (name: string, error: unknown) => void;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
};

export function createBeatAudioFromEngine({ engine, assets, onAssetError, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = h => clearTimeout(h as never) }: AudioDeps): BeatAudio {
    const ctx = engine.context as Ctx;
    let master: { gain: Param; connect(n: unknown): unknown } | null = null;
    const strips = new Map<string, Strip>();
    const levels = new Map<string, TrackMix>();
    let timer: unknown = null;
    let handlers: PlayHandlers = {};
    // N5: the song plays through the shared web mix graph (strips, effects, sends, master, automation).
    const mixRun = createMixRun(engine, message => { try { handlers.onEffectError?.(message); } catch { /* A consumer callback cannot escape the timer. */ } });
    let playing = false;
    let starting = false;
    let closed = false;
    const keys = new Map<string, { voice?: BeatVoice }>();
    let cursor = 0;
    let nextTime = 0;
    let getDoc: (() => BeatDoc | undefined) | null = null;
    let onStep: ((step: number) => void) | undefined;
    let windowCallback: ((window: SongWindow) => void) | undefined;
    const plainOutput = (id: string, doc: BeatDoc) => {
        const track = doc.tracks.find(t => t.id === id)!;
        const s = strip(id); s.gain.value = audibleGain(doc, track); s.pan.value = track.pan; return s.input;
    };
    // A mixer failure during recording falls back to the plain strip: it must never end the take.
    const rangeOutput = (id: string, doc: BeatDoc, at: number) => {
        try { return mixRun.destination(id, doc, at); } catch { return plainOutput(id, doc); }
    };
    const takes = createTakePlayback(ctx as PlaybackContext, undefined, (id, doc, untilTime) => {
        if (range.isPlaying()) return rangeOutput(id, doc, untilTime);
        return mixRun.run() ? mixRun.destination(id, doc, untilTime) : plainOutput(id, doc);
    }, assets, (asset, error) => onAssetError?.(asset.name, error));
    const range = createRecordingTransport(engine, rangeOutput, (doc, w, bounds) => {
        try { mixRun.sync(doc); mixRun.schedule(doc, w.fromSec, w.toSec, w.contextTime); } catch { /* rangeOutput falls back. */ }
        const token = playGeneration;
        void takes.window(doc, w, bounds, { recording: true }).catch(error => { if (token === playGeneration) fail(error); });
    }, setTimer, clearTimer);
    let playGeneration = 0;
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
            engine.setTrackMix(engine.live, track.id, gain, track.pan);
        }
    }
    function halt() {
        playGeneration++; starting = false; playing = false;
        range.stop(); takes.stop();
        if (timer !== null) clearTimer(timer);
        timer = null;
        mixRun.stop();
    }
    function fail(error: unknown) {
        try { halt(); } catch { /* Preserve the original engine error. */ }
        try { handlers.onError?.(error); } catch { /* A consumer callback cannot escape the timer. */ }
    }
    function tick() {
        timer = null;
        if (!getDoc || !playing) return;
        try {
            const current = getDoc();
            // The beat can leave the store while it plays (deleted, account reset): stop instead of throwing in a timer.
            if (!current) { halt(); return; }
            mixRun.sync(current); syncMidi(current);
            const horizon = engine.now() + LOOKAHEAD_S;
            while (nextTime < horizon) {
                const doc = getDoc();
                if (!doc) { halt(); return; }
                const { from, to } = playRange(doc);
                const step = from + (cursor % (to - from));
                const seconds = stepSeconds(doc.tempo.bpm);
                const fromSec = step * seconds;
                mixRun.schedule(doc, fromSec, fromSec + seconds, nextTime);
                for (const event of eventsAtStep(doc, step)) {
                    const at = eventTime(nextTime, step, doc.tempo.bpm, doc.swing);
                    engine.playPad(event.pad, event.velocity, at, mixRun.destination(event.trackId, doc, at), doc.tracks.find(t => t.id === event.trackId)?.kit ?? DRUM_KITS[0].id);
                }
                for (const event of midiNoteOnsInWindow(doc, fromSec, fromSec + seconds)) {
                    const track = midiTracks(doc).find(t => t.id === event.trackId);
                    if (!track) continue;
                    const at = nextTime + event.songTimeSec - fromSec;
                    mixRun.destination(track.id, doc, at);
                    engine.playMidi(track, event.pitch, event.velocity, at, mixRun.run()!, audibleGain(doc, track)).release(at + event.durationSec);
                }
                const window = { fromSec, toSec: fromSec + seconds, contextTime: nextTime };
                windowCallback?.(window);
                const token = playGeneration;
                void takes.window(doc, window, { startSec: 0, endSec: tickSeconds(songEnd(doc), doc.tempo.bpm) })
                    .catch(error => { if (token === playGeneration) fail(error); });
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
        meterTap: trackId => playing || range.isPlaying() ? mixRun.meterTap(trackId) : null,
        recordingEngine: () => engine,
        async playRange(options) {
            this.stop(); handlers = {}; const token = playGeneration; configureNativeTakeStorage();
            await takes.preload(options.getDoc(), { recording: true });
            if (token !== playGeneration) throw new Error('transport_cancelled');
            return range.play(options);
        },
        async play(read, step, onWindow, startOffsetSec = 0, on = {}) {
            if (playing) return 'started';
            if (starting) return 'busy';
            if (closed) return 'cancelled';
            const token = ++playGeneration;
            starting = true;
            handlers = on;
            try {
                const initial = read();
                if (!initial) return 'cancelled';
                await takes.preload(initial);
                if (token === playGeneration && !closed) await engine.resume();
            } catch (error) {
                if (token !== playGeneration || closed || (error as { name?: string })?.name === 'AbortError') return 'cancelled';
                throw error;
            } finally { if (token === playGeneration) starting = false; }
            if (token !== playGeneration || closed) return 'cancelled';
            playing = true;
            windowCallback = onWindow;
            getDoc = read; onStep = step; cursor = 0; nextTime = engine.now() + 0.1 + startOffsetSec;
            tick();
            return 'started';
        },
        // A UI stop or close never throws: the player is already stopped when a node fails to release.
        stop() { try { halt(); } catch (error) { try { handlers.onError?.(error); } catch { /* ignore */ } } },
        isPlaying: () => playing || range.isPlaying(),
        hitPad(pad, kit, velocity = PAD_VELOCITY) {
            void engine.resume();
            engine.playPad(pad, velocity, engine.now(), bus(), kit);
        },
        setTrackMix(trackId, mix) {
            levels.set(trackId, mix);
            const s = strips.get(trackId);
            if (s) { s.gain.value = mix.gain; s.pan.value = mix.pan; }
            const doc = getDoc?.();
            if (doc) { syncMidi(doc); if (playing) { try { mixRun.sync(doc); } catch (error) { fail(error); } } }
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
        async close() { closed = true; this.stop(); this.releaseKeys(); takes.close(); await engine.close(); },
    };
}

/** The shipping implementation: the shared web engine on `react-native-audio-api` (docs/mobile/spikes/N0-NATIVE-ENGINE.md). */
export function createBeatAudio(Context: NativeContextCtor = loadNativeContext(), assets?: NativeAssetPort, onAssetError?: (name: string, error: unknown) => void): BeatAudio {
    return createBeatAudioFromEngine({ engine: createNativeBeatEngine({ Context }).engine, assets, onAssetError });
}
