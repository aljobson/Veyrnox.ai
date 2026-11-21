import type { BeatDoc } from './doc';
import type { EngineContext, ParamLike } from './shared';
import { audioPieces, loadBeatTake, type AudioTake, type SongWindow } from './takeShared';
export type BufferLike = { getChannelData(n: number): Float32Array };
type Node = { connect(to: unknown): unknown; disconnect(): void };
type Source = Node & { buffer: BufferLike | null; onended: (() => void) | null; start(at: number, offset?: number, duration?: number): void; stop(at?: number): void };
export type PlaybackContext = EngineContext & {
    createBuffer(channels: number, length: number, sr: number): BufferLike;
    createBufferSource(): Source;
    createGain(): Node & { gain: ParamLike };
    createStereoPanner(): Node & { pan: ParamLike };
};
export function createTakePlayback(context: PlaybackContext, load: (id: string) => Promise<AudioTake | null> = loadBeatTake, output?: (id: string, doc: BeatDoc, untilTime: number) => unknown) {
    const buffers = new Map<string, BufferLike>();
    const loading = new Map<string, Promise<BufferLike | null>>();
    const active = new Set<{ source: Source; gain: Node; pan: Node }>();
    let generation = 0;
    async function buffer(id: string, reverse: boolean) {
        const key = `${id}:${reverse}`;
        if (buffers.has(key)) return buffers.get(key)!;
        if (loading.has(key)) return loading.get(key)!;
        const work = load(id).then(row => {
            if (!row) return null;
            const result = context.createBuffer(1, row.samples.length, row.sampleRate);
            result.getChannelData(0).set(reverse ? row.samples.slice().reverse() : row.samples);
            buffers.set(key, result); return result;
        }).finally(() => loading.delete(key));
        loading.set(key, work); return work;
    }
    return {
        async preload(doc: BeatDoc) {
            await Promise.all(Object.values(doc.assets ?? {}).filter(a => a.source === 'take').map(a => buffer(a.ref, false)));
        },
        async window(doc: BeatDoc, w: SongWindow, bounds: { startSec: number; endSec: number }) {
            const token = generation;
            await Promise.all(audioPieces(doc, w.fromSec, w.toSec, bounds).map(async piece => {
                const asset = doc.assets?.[piece.assetId]; if (asset?.source !== 'take') return;
                const decoded = await buffer(asset.ref, piece.reverse);
                if (!decoded || token !== generation) return;
                const at = w.contextTime + piece.songTimeSec - w.fromSec;
                const late = Math.max(0, context.currentTime - at);
                const duration = Math.min(piece.durationSec, bounds.endSec - piece.songTimeSec) - late;
                if (duration <= 0) return;
                const track = doc.tracks.find(t => t.id === piece.trackId)!;
                const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
                const start = at + late;
                // The end time keeps a replaced mix run alive until this piece has finished playing.
                source.buffer = decoded; source.connect(gain); gain.connect(pan); pan.connect(output ? output(piece.trackId, doc, start + duration) : context.destination);
                gain.gain.setValueAtTime(piece.gain * (output ? 1 : track.gain), start);
                gain.gain.linearRampToValueAtTime(piece.endGain * (output ? 1 : track.gain), start + duration);
                pan.pan.value = output ? 0 : track.pan;
                const owned = { source, gain, pan }; active.add(owned);
                source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); active.delete(owned); };
                source.start(start, piece.offsetSec + late, duration);
                // A whole piece may outlive this lookahead window, but never its cycle boundary.
                source.stop(start + duration);
            }));
        },
        stop() {
            generation++;
            for (const { source, gain, pan } of active) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); gain.disconnect(); pan.disconnect(); }
            active.clear();
        },
        close() { this.stop(); buffers.clear(); },
    };
}
