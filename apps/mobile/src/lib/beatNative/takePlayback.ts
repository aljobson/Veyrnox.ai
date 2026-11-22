import type { BeatAsset, BeatDoc } from './doc';
import type { EngineContext, ParamLike } from './shared';
import { audioPieces, loadBeatTake, type AudioTake, type SongWindow } from './takeShared';
import type { NativeAssetPort } from './nativeAssets';
import type { RangeAssetMode } from './transport';

const MAX_CACHE_BYTES = 300_000_000;
export type PlaybackBuffer = {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    getChannelData(n: number): Float32Array;
};
type Node = { connect(to: unknown): unknown; disconnect(): void };
type Source = Node & { buffer: PlaybackBuffer | null; onended: (() => void) | null; start(at: number, offset?: number, duration?: number): void; stop(at?: number): void };
export type PlaybackContext = EngineContext & {
    createBuffer(channels: number, length: number, sr: number): PlaybackBuffer;
    createBufferSource(): Source;
    createGain(): Node & { gain: ParamLike };
    createStereoPanner(): Node & { pan: ParamLike };
    decodeAudioData(bytes: ArrayBuffer): Promise<PlaybackBuffer>;
};
const bytes = (buffer: PlaybackBuffer) => buffer.length * buffer.numberOfChannels * 4;
const refKey = (ref: BeatAsset['ref']) => typeof ref === 'string' ? ref : JSON.stringify(ref, Object.keys(ref).sort());

export function createTakePlayback(context: PlaybackContext, load: (id: string) => Promise<AudioTake | null> = loadBeatTake,
    output?: (id: string, doc: BeatDoc, untilTime: number) => unknown, assets?: NativeAssetPort,
    onAssetError?: (asset: BeatAsset, error: unknown) => void) {
    const buffers = new Map<string, PlaybackBuffer>();
    const loading = new Map<string, Promise<PlaybackBuffer | null>>();
    const active = new Set<{ source: Source; gain: Node; pan: Node }>();
    let pinned = new Set<string>();
    let cacheBytes = 0;
    let generation = 0;
    let controller = new AbortController();
    const failures = new Map<string, { permanent: boolean; error: unknown }>();
    const announced = new Set<string>();

    const errorCode = (error: unknown) => (error as { code?: unknown })?.code;
    const errorStatus = (error: unknown) => (error as { status?: unknown })?.status;
    function fatal(error: unknown) {
        const message = (error as Error)?.message;
        return message === 'audio_playback_too_large' || message === 'account_changed' || errorCode(error) === 'account_changed'
            || (error as { name?: string })?.name === 'AbortError';
    }
    function permanent(error: unknown) {
        return errorCode(error) === 'held' || [404, 410].includes(Number(errorStatus(error)));
    }
    function report(key: string, asset: BeatAsset, error: unknown) {
        if (announced.has(key)) return;
        announced.add(key);
        try { onAssetError?.(asset, error); } catch { /* A notice cannot stop the transport. */ }
    }

    function retain(key: string, value: PlaybackBuffer) {
        if (bytes(value) > MAX_CACHE_BYTES) throw new Error('audio_playback_too_large');
        const previous = buffers.get(key);
        if (previous) cacheBytes -= bytes(previous);
        buffers.delete(key);
        buffers.set(key, value);
        cacheBytes += bytes(value);
        while (cacheBytes > MAX_CACHE_BYTES) {
            const oldest = [...buffers.entries()].find(([candidate]) => !pinned.has(candidate));
            if (!oldest) break;
            buffers.delete(oldest[0]); cacheBytes -= bytes(oldest[1]);
        }
        if (cacheBytes > MAX_CACHE_BYTES) {
            buffers.delete(key); cacheBytes -= bytes(value);
            if (previous) { buffers.set(key, previous); cacheBytes += bytes(previous); }
            throw new Error('audio_playback_too_large');
        }
    }
    function cached(key: string) {
        const value = buffers.get(key);
        if (value) { buffers.delete(key); buffers.set(key, value); }
        return value;
    }
    function keyOf(asset: BeatAsset, bpm: number, reverse: boolean) {
        return `${asset.source}:${refKey(asset.ref)}:${asset.durationSec}:${asset.sourceChannels}:${asset.encodedBytes}`
            + `${asset.source === 'sound' ? `:${bpm}` : ''}:${reverse}`;
    }
    function reverseBuffer(source: PlaybackBuffer) {
        const result = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
        for (let channel = 0; channel < source.numberOfChannels; channel++) {
            const from = source.getChannelData(channel), to = result.getChannelData(channel);
            for (let at = 0; at < to.length; at++) to[at] = from[from.length - 1 - at];
        }
        return result;
    }
    async function baseBuffer(asset: BeatAsset, bpm: number, signal: AbortSignal): Promise<PlaybackBuffer | null> {
        if (asset.source === 'take') {
            const row = await load(asset.ref);
            if (!row) return null;
            const result = context.createBuffer(1, row.samples.length, row.sampleRate);
            result.getChannelData(0).set(row.samples);
            return result;
        }
        if (asset.source === 'stem') throw new Error('stem_playback_unavailable');
        if (!assets) throw new Error('audio_asset_loader_unavailable');
        return assets.load(asset, bpm, context, signal);
    }
    async function buffer(asset: BeatAsset, bpm: number, reverse: boolean, recording = false) {
        const key = keyOf(asset, bpm, reverse);
        const plainKey = keyOf(asset, bpm, false);
        pinned.add(plainKey); pinned.add(key);
        const failed = failures.get(plainKey);
        if (failed) { report(plainKey, asset, failed.error); return null; }
        const ready = cached(key);
        if (ready) return ready;
        if (loading.has(key)) return loading.get(key)!;
        const token = generation, signal = controller.signal;
        let work!: Promise<PlaybackBuffer | null>;
        work = (async () => {
            let plain: PlaybackBuffer | null | undefined = cached(plainKey);
            if (!plain) {
                const pending = key === plainKey ? undefined : loading.get(plainKey);
                try { plain = pending ? await pending : await baseBuffer(asset, bpm, signal); }
                catch (error) {
                    if (fatal(error)) {
                        if (!recording || (error as Error)?.message !== 'audio_playback_too_large') throw error;
                        failures.set(plainKey, { permanent: false, error }); report(plainKey, asset, error); return null;
                    }
                    failures.set(plainKey, { permanent: permanent(error), error }); report(plainKey, asset, error); return null;
                }
                if (!plain || token !== generation || signal.aborted) return null;
                try { retain(plainKey, plain); }
                catch (error) {
                    if (!recording || (error as Error)?.message !== 'audio_playback_too_large') throw error;
                    failures.set(plainKey, { permanent: false, error }); report(plainKey, asset, error); return null;
                }
            }
            if (token !== generation || signal.aborted) return null;
            const result = reverse ? reverseBuffer(plain) : plain;
            if (reverse) try { retain(key, result); }
            catch (error) {
                if (!recording || (error as Error)?.message !== 'audio_playback_too_large') throw error;
                failures.set(plainKey, { permanent: false, error }); report(plainKey, asset, error); return null;
            }
            return result;
        })().finally(() => { if (loading.get(key) === work) loading.delete(key); });
        loading.set(key, work); return work;
    }
    return {
        async preload(doc: BeatDoc, options: { recording?: boolean; assetMode?: RangeAssetMode } = {}) {
            const all = new Map<string, { asset: BeatAsset; reverse: boolean; audible: boolean }>();
            const solo = doc.tracks.some(track => track.solo);
            for (const track of doc.tracks) for (const region of track.regions) {
                if (track.kind !== 'audio' || !region.assetId) continue;
                const asset = doc.assets?.[region.assetId];
                if (!asset || asset.source === 'stem' || (options.recording && options.assetMode !== 'all-supported' && asset.source !== 'take')) continue;
                const selected = keyOf(asset, doc.tempo.bpm, !!region.reverse);
                all.set(selected, { asset, reverse: !!region.reverse, audible: !track.mute && (!solo || track.solo) });
            }
            const prepare = (source: typeof all) => {
                const wanted = new Map<string, { asset: BeatAsset; reverse: boolean }>(), keys = new Set<string>(), estimates = new Map<string, number>();
                for (const [selected, item] of source) {
                    const plain = keyOf(item.asset, doc.tempo.bpm, false), pcm = Math.ceil(item.asset.durationSec * 48_000) * item.asset.sourceChannels * 4;
                    keys.add(plain); keys.add(selected); estimates.set(plain, pcm); estimates.set(selected, pcm);
                    wanted.set(selected, item);
                }
                return { wanted, keys, estimated: [...estimates.values()].reduce((total, value) => total + value, 0) };
            };
            let plan = prepare(all);
            if (plan.estimated > MAX_CACHE_BYTES) plan = prepare(new Map([...all].filter(([, item]) => item.audible)));
            if (plan.estimated > MAX_CACHE_BYTES) {
                const error = new Error('audio_playback_too_large');
                if (!options.recording) throw error;
                for (const [key, item] of plan.wanted) {
                    const plain = keyOf(item.asset, doc.tempo.bpm, false);
                    failures.set(plain, { permanent: false, error }); report(plain, item.asset, error); pinned.add(key);
                }
                return;
            }
            const { wanted, keys } = plan;
            pinned = keys;
            for (const [key, value] of buffers) if (!pinned.has(key)) { buffers.delete(key); cacheBytes -= bytes(value); }
            // Sequential decode prevents several large regions from peaking in memory together.
            for (const item of wanted.values()) await buffer(item.asset, doc.tempo.bpm, item.reverse, !!options.recording);
        },
        async window(doc: BeatDoc, w: SongWindow, bounds: { startSec: number; endSec: number }, options: { recording?: boolean; assetMode?: RangeAssetMode } = {}) {
            const token = generation;
            await Promise.all(audioPieces(doc, w.fromSec, w.toSec, bounds).map(async piece => {
                const asset = doc.assets?.[piece.assetId]; if (!asset || asset.source === 'stem') return;
                if (options.recording && options.assetMode !== 'all-supported' && asset.source !== 'take') return;
                const decoded = await buffer(asset, doc.tempo.bpm, piece.reverse, !!options.recording);
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
            pinned.clear();
            announced.clear();
            for (const [key, failure] of failures) if (!failure.permanent) failures.delete(key);
            controller.abort(); controller = new AbortController(); loading.clear();
            for (const { source, gain, pan } of active) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); gain.disconnect(); pan.disconnect(); }
            active.clear();
        },
        close() { this.stop(); buffers.clear(); cacheBytes = 0; },
    };
}
