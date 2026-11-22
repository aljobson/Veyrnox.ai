import { fetch as streamFetch } from 'expo/fetch';
import type { SessionTask } from '../../auth/sessionTask';
import type { ApiClient } from '../api';
import { renderSoundWav } from './soundPreview';
import { soundById } from './labs';
import type { BeatSoundAsset } from './doc';
import type { PlaybackContext, PlaybackBuffer } from './takePlayback';
// @ts-ignore shared bounded loader; this native seam supplies Expo fetch and the native decoder.
import * as audioFetch from '../../../../../app/veyrnox/_lib/music/beat/beatAudioFetch.mjs';
// @ts-ignore shared release-authority path; the server remains the source of truth.
import * as availability from '../../../../../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';
// @ts-ignore shared document validator remains the authority for ref shape and audio bounds.
import * as audioRules from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';

export type NativePlayableAsset = {
    source: 'sound' | 'song' | 'target';
    ref: string | Record<string, string>;
    name: string;
    durationSec: number;
    bpm: number | null;
    sourceChannels: number;
    encodedBytes: number;
};

export type NativeAssetPort = {
    load(asset: NativePlayableAsset, bpm: number, context: PlaybackContext, signal?: AbortSignal): Promise<PlaybackBuffer>;
};

type NativeAssetDeps = {
    fetchAudio: typeof fetch;
    fetchAsset: typeof sharedFetch;
    signingPath: typeof signingPath;
    validAsset: typeof validAsset;
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

function signedUrl(value: unknown): value is { url: string } {
    return !!value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'
        && /^https:\/\//.test((value as { url: string }).url);
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
        ...injected,
    };
    return {
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
            for (let attempt = 0; attempt < 2; attempt++) {
                const signed = await api.request<unknown>(`/api/v1${path}`, { signal }, { owner: task.user, task });
                ensureCurrent(task);
                if (!signedUrl(signed)) throw new Error('asset_unavailable');
                try {
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
                    const status = (error as { status?: number }).status;
                    if (attempt === 0 && (status === 401 || status === 403)) continue;
                    throw error;
                }
            }
            throw new Error('asset_unavailable');
        },
    };
}
