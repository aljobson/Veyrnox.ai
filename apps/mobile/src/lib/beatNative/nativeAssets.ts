import { fetch as streamFetch } from 'expo/fetch';
import type { SessionTask } from '../../auth/sessionTask';
import type { ApiClient } from '../api';
import { renderSoundWav } from './soundPreview';
import { soundById } from './labs';
import type { BeatSoundAsset } from './doc';
import type { PlaybackContext, PlaybackBuffer } from './takePlayback';
import { createNativeHeldAssets, nativeHeldError, recordNativeHeldError, type NativeHeldAssets } from './nativeHeldAssets';
import { loadNativeStemArchive, loadNativeStemArchiveParts, type StemParts } from './stemArchive';
// @ts-ignore shared bounded loader; this native seam supplies Expo fetch and the native decoder.
import * as audioFetch from '../../../../../app/veyrnox/_lib/music/beat/beatAudioFetch.mjs';
// @ts-ignore shared release-authority path; the server remains the source of truth.
import * as availability from '../../../../../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';
// @ts-ignore shared document validator remains the authority for ref shape and audio bounds.
import * as audioRules from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';

export type NativePlayableAsset = {
    source: 'sound' | 'song' | 'stem' | 'target';
    ref: string | Record<string, string>;
    name: string;
    durationSec: number;
    bpm: number | null;
    sourceChannels: number;
    encodedBytes: number;
};

export type NativeAssetPort = {
    load(asset: NativePlayableAsset, bpm: number, context: PlaybackContext, signal?: AbortSignal): Promise<PlaybackBuffer>;
    readonly heldAssets?: NativeHeldAssets;
    releaseArchives?(): void;
    close?(): void;
};

type NativeAssetDeps = {
    fetchAudio: typeof fetch;
    fetchAsset: typeof sharedFetch;
    signingPath: typeof signingPath;
    validAsset: typeof validAsset;
    checkDecoded: typeof checkDecoded;
    loadStem: typeof loadNativeStemArchive;
    loadStemParts: typeof loadNativeStemArchiveParts;
    heldAssets: NativeHeldAssets;
};

type StemPart = keyof StemParts;
type StemRun = {
    controller: AbortController;
    pending: Promise<StemParts>;
    delivered: Set<StemPart>;
    waiters: Set<symbol>;
    settled: boolean;
};

const sharedFetch = (audioFetch as unknown as {
    fetchAudioAsset(url: string, base: Omit<NativePlayableAsset, 'durationSec' | 'sourceChannels' | 'encodedBytes'>,
        stored: NativePlayableAsset,
        deps: { fetchAudio: typeof fetch; decode(bytes: ArrayBuffer): Promise<PlaybackBuffer> }): Promise<{ buffer: PlaybackBuffer }>;
}).fetchAudioAsset;

const signingPath = (availability as unknown as {
    assetSigningPath(asset: Pick<NativePlayableAsset, 'source' | 'ref'>): string | null;
}).assetSigningPath;

const validAsset = (audioRules as unknown as { validAsset(asset: NativePlayableAsset, bpm: number): boolean }).validAsset;
const checkDecoded = (audioRules as unknown as {
    checkDecoded(buffer: Pick<PlaybackBuffer, 'length' | 'numberOfChannels' | 'sampleRate'>, asset: NativePlayableAsset): void;
}).checkDecoded;

function signedUrl(value: unknown): value is { url: string; size_bytes?: number } {
    if (!value || typeof value !== 'object' || typeof (value as { url?: unknown }).url !== 'string'
        || !/^https:\/\//.test((value as { url: string }).url)) return false;
    const size = (value as { size_bytes?: unknown }).size_bytes;
    return size === undefined || typeof size === 'number' && Number.isSafeInteger(size) && size > 0;
}

function ensureCurrent(task: SessionTask) {
    if (!task.current()) throw new Error('account_changed');
}

/**
 * Loads every non-take asset through the same bounded web validator used by song seeding.
 * Signed URLs are fetched only after an owner-fenced API read, and are never persisted.
 */
export function createNativeAssetPort(api: ApiClient, task: SessionTask, injected: Partial<NativeAssetDeps> = {}): NativeAssetPort {
    const deps: NativeAssetDeps = {
        fetchAudio: streamFetch as unknown as typeof fetch,
        fetchAsset: sharedFetch,
        signingPath,
        validAsset,
        checkDecoded,
        loadStem: loadNativeStemArchive,
        loadStemParts: loadNativeStemArchiveParts,
        heldAssets: createNativeHeldAssets(),
        ...injected,
    };
    const stemRuns = new Map<string, StemRun>();
    const abortStemRuns = () => {
        for (const run of stemRuns.values()) if (!run.settled) run.controller.abort(new Error('audio_load_cancelled'));
        stemRuns.clear();
    };
    const waitForStemRun = async (requestId: string, run: StemRun, signal?: AbortSignal) => {
        if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
        const waiter = Symbol(requestId);
        run.waiters.add(waiter);
        let remove = () => {};
        const aborted = signal ? new Promise<never>((_, reject) => {
            const cancel = () => reject(signal.reason ?? new Error('audio_load_cancelled'));
            signal.addEventListener('abort', cancel, { once: true });
            remove = () => signal.removeEventListener('abort', cancel);
        }) : null;
        try {
            return await (aborted ? Promise.race([run.pending, aborted]) : run.pending);
        } finally {
            remove();
            run.waiters.delete(waiter);
            // A caller owns only its wait. The shared transfer is cancelled only when no live caller remains.
            if (!run.settled && run.waiters.size === 0 && signal?.aborted) {
                run.controller.abort(signal.reason ?? new Error('audio_load_cancelled'));
                if (stemRuns.get(requestId) === run) stemRuns.delete(requestId);
            }
        }
    };
    const loadStemPart = async (requestId: string, input: Parameters<typeof loadNativeStemArchive>[0]) => {
        // Focused tests and custom adapters may still inject the legacy one-part seam.
        if (injected.loadStem && !injected.loadStemParts) return deps.loadStem(input);
        let run = stemRuns.get(requestId);
        if (!run) {
            const controller = new AbortController();
            run = { controller, delivered: new Set(), waiters: new Set(), settled: false, pending: Promise.resolve({} as StemParts) };
            const owned = run;
            owned.pending = deps.loadStemParts({ url: input.url, sizeBytes: input.sizeBytes, signal: controller.signal, current: input.current })
                .then(parts => { owned.settled = true; return parts; })
                .catch(error => {
                    owned.settled = true;
                    if (stemRuns.get(requestId) === owned) stemRuns.delete(requestId);
                    throw error;
                });
            stemRuns.set(requestId, owned);
        }
        const parts = await waitForStemRun(requestId, run, input.signal);
        const part = input.part as StemPart;
        const bytes = parts[part];
        run.delivered.add(part);
        // Both extracted entries have now crossed into their decoded owners. Release the archive cache immediately.
        if (run.delivered.size === 2 && stemRuns.get(requestId) === run) stemRuns.delete(requestId);
        return bytes;
    };
    return {
        heldAssets: deps.heldAssets,
        releaseArchives: abortStemRuns,
        close: abortStemRuns,
        async load(asset, bpm, context, signal) {
            ensureCurrent(task);
            if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
            if (!deps.validAsset(asset, bpm)) throw new Error('asset_unavailable');
            if (asset.source === 'sound') {
                const sound = soundById((asset as BeatSoundAsset).ref);
                if (!sound) throw new Error('sound_unavailable');
                const wav = renderSoundWav(sound, bpm);
                const decoded = await context.decodeAudioData(wav);
                ensureCurrent(task);
                if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
                return decoded;
            }

            if (!task.user) throw new Error('not_authenticated');
            const path = deps.signingPath(asset);
            if (!path) throw new Error('asset_unavailable');
            deps.heldAssets.assertAvailable(asset);
            for (let attempt = 0; attempt < 2; attempt++) {
                let signed: unknown;
                try {
                    signed = await api.request<unknown>(`/api/v1${path}`, { signal }, { owner: task.user, task });
                } catch (error) {
                    ensureCurrent(task);
                    if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
                    if (recordNativeHeldError(deps.heldAssets, asset, error)) throw nativeHeldError();
                    throw error;
                }
                ensureCurrent(task);
                if (!signedUrl(signed)) throw new Error('asset_unavailable');
                try {
                    if (asset.source === 'stem') {
                        const sizeBytes = signed.size_bytes;
                        const part = typeof asset.ref === 'object' ? asset.ref.part : undefined;
                        const requestId = typeof asset.ref === 'object' ? asset.ref.requestId : undefined;
                        if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes)
                            || typeof requestId !== 'string' || part !== 'vocals' && part !== 'instrumental') throw new Error('asset_unavailable');
                        const bytes = await loadStemPart(requestId, { url: signed.url, sizeBytes, part, signal, current: task.current });
                        ensureCurrent(task);
                        if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
                        if (bytes.length !== asset.encodedBytes) throw new Error('asset_unavailable');
                        const encoded = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
                            ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                        const decoded = await context.decodeAudioData(encoded as ArrayBuffer);
                        ensureCurrent(task);
                        if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
                        deps.checkDecoded(decoded, asset);
                        return decoded;
                    }
                    const loaded = await deps.fetchAsset(signed.url, {
                        source: asset.source,
                        ref: asset.ref,
                        name: asset.name,
                        bpm: asset.bpm,
                    }, asset, {
                        fetchAudio: ((url: RequestInfo | URL, init?: RequestInit) => deps.fetchAudio(url, { ...init, signal })) as typeof fetch,
                        decode: bytes => context.decodeAudioData(bytes),
                    });
                    ensureCurrent(task);
                    if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
                    return loaded.buffer;
                } catch (error) {
                    ensureCurrent(task);
                    if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
                    if (recordNativeHeldError(deps.heldAssets, asset, error)) throw nativeHeldError();
                    const status = (error as { status?: number }).status;
                    if (attempt === 0 && (status === 401 || status === 403)) continue;
                    throw error;
                }
            }
            throw new Error('asset_unavailable');
        },
    };
}
