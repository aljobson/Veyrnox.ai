import { audibleGain, type BeatDoc } from './doc';
import { runKey } from './mix';
import type { BeatEngine, Run } from './shared';

type Active = { run: Run; key: string; lastOnset: number };
export function createMixRun(engine: BeatEngine, onEffectError: (message: string) => void = () => undefined) {
    let current: Active | null = null;
    const retired = new Set<Active>();
    function collect() {
        for (const old of retired) if (engine.now() > old.lastOnset + 0.03) {
            engine.stopRun(old.run); retired.delete(old);
        }
    }
    return {
        sync(doc: BeatDoc): { restarted: boolean } {
            // Collect before replacement: a run with no queued hit retires on the next tick.
            collect();
            const key = runKey(doc);
            if (!current || current.key !== key) {
                if (current) { retired.add(current); current = null; }
                let reported = false;
                // The web graph skips an effect it cannot build (EFFECT_UNAVAILABLE); say so once per run, never hide it.
                const onError = (message: string) => { if (!reported) { reported = true; onEffectError(message); } };
                current = { run: engine.startRun(doc, { onError }), key, lastOnset: -Infinity };
                return { restarted: true };
            }
            for (const t of doc.tracks) engine.setTrackMix(current.run, t.id, audibleGain(doc, t), t.pan, doc);
            return { restarted: false };
        },
        destination(trackId: string, doc: BeatDoc, at = engine.now()): unknown {
            if (!current) this.sync(doc);
            const t = doc.tracks.find(track => track.id === trackId);
            if (!t || !current) throw new Error('Missing mix track');
            const destination = engine.setTrackMix(current.run, trackId, audibleGain(doc, t), t.pan, doc);
            current.lastOnset = Math.max(current.lastOnset, at);
            return destination;
        },
        schedule(doc: BeatDoc, fromSec: number, toSec: number, contextTime: number) {
            for (const t of doc.tracks) current?.run.channels.get(t.id)?.schedule({ fromSec, toSec, contextTime });
        },
        stop() {
            const runs = [...retired, ...(current ? [current] : [])];
            current = null; retired.clear();
            // A failed node must not prevent the other runs from being stopped.
            let failure: unknown;
            for (const { run } of runs) { try { engine.stopRun(run); } catch (error) { failure ??= error; } }
            if (failure) throw failure;
        },
        meterTap(trackId: string): unknown | null { return current ? engine.meterTap(trackId) ?? null : null; },
    };
}
