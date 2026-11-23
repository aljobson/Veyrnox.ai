import { eventsAtStep, eventTime, stepSeconds, type BeatDoc } from './doc';
import type { BeatEngine } from './shared';
import { songWindowToContext, tickSeconds, type SongWindow } from './takeShared';
export type RangeAssetMode = 'takes-only' | 'all-supported';
export type PlayRange = {
    getDoc(): BeatDoc | undefined;
    startTick: number;
    endTick: number;
    cycle: { start: number; end: number } | null;
    countInBars: 0 | 1;
    assetMode?: RangeAssetMode;
    onWindow(w: SongWindow): void;
    onError?(error: unknown): void;
};
export function createRecordingTransport(engine: BeatEngine, output: (id: string, doc: BeatDoc, at: number) => unknown,
    takes: (doc: BeatDoc, window: SongWindow, bounds: { startSec: number; endSec: number }) => void,
    setTimer: (fn: () => void, ms: number) => unknown, clearTimer: (id: unknown) => void,
    clickOutput: (doc: BeatDoc, at: number) => unknown = () => engine.context.destination) {
    let timer: unknown = null, generation = 0, running = false;
    // Recording must survive an unavailable mix node. Production supplies its own master fallback; this is the final guard.
    const safeClickOutput = (doc: BeatDoc, at: number) => {
        try { return clickOutput(doc, at); } catch { return engine.context.destination; }
    };
    return {
        async play(options: PlayRange) {
            this.stop(); const token = generation; await engine.resume();
            if (generation !== token) throw new Error('transport_cancelled');
            const doc = options.getDoc();
            if (!doc) throw new Error('beat_unavailable');
            running = true;
            const bpm = doc.tempo.bpm, stepDuration = stepSeconds(bpm);
            const contextStart = engine.now() + 0.1;
            const origin = contextStart + options.countInBars * tickSeconds(3840, bpm);
            const startSec = tickSeconds(options.startTick, bpm), endSec = tickSeconds(options.endTick, bpm);
            const cycle = options.cycle && { start: tickSeconds(options.cycle.start, bpm), end: tickSeconds(options.cycle.end, bpm) };
            if (options.countInBars) for (let i = 0; i < 4; i++) {
                const at = contextStart + i * 60 / bpm;
                engine.click(at, i === 0, safeClickOutput(doc, at));
            }
            let cursor = 0, step = options.startTick / 240, next = origin;
            const tick = () => {
                if (!running || generation !== token) return;
                try {
                    const latest = options.getDoc();
                    if (!latest) throw new Error('beat_unavailable');
                    const horizon = engine.now() + 0.15;
                    const until = Math.max(cursor, horizon - origin);
                    for (const window of songWindowToContext(cursor, until, { startSec, contextStart: origin, cycle, endSec })) {
                        options.onWindow(window);
                        const wrapped = !!cycle && startSec + window.contextTime - origin >= cycle.end - 1e-9;
                        takes(latest, window, { startSec: wrapped ? cycle!.start : startSec, endSec: cycle?.end ?? endSec });
                    }
                    cursor = until;
                    while (next < horizon) {
                        if (options.cycle && step >= options.cycle.end / 240) step = options.cycle.start / 240;
                        if (!options.cycle && step >= options.endTick / 240) break;
                        const at = eventTime(next, step, bpm, latest.swing);
                        if (latest.metronome && step % 4 === 0 && next >= engine.now()) {
                            engine.click(next, step % 16 === 0, safeClickOutput(latest, next));
                        }
                        if (at >= engine.now()) for (const event of eventsAtStep(latest, step)) {
                            const track = latest.tracks.find(t => t.id === event.trackId)!;
                            engine.playPad(event.pad, event.velocity, at, output(track.id, latest, at), track.kit);
                        }
                        next += stepDuration; step++;
                    }
                    timer = setTimer(tick, 25);
                } catch (error) {
                    generation++; running = false;
                    if (timer !== null) clearTimer(timer);
                    timer = null;
                    try { options.onError?.(error); } catch { /* A consumer callback cannot escape the transport. */ }
                }
            };
            tick(); return { contextStart, recordContextStart: origin };
        },
        stop() { generation++; running = false; if (timer !== null) clearTimer(timer); timer = null; },
        isPlaying: () => running,
    };
}
