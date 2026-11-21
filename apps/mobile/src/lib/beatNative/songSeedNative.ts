import { fetch as streamFetch } from 'expo/fetch';
import { getSong } from '../music/client';
import { userIdFromToken } from '../appCache';
import type { ApiClient } from '../api';
import { isOffline } from '../networkState';
import { loadNativeContext } from './nativeContext';
import { beatStore } from './store';
import type { DecodedAudio, SeedDeps } from './songSeed';
// @ts-ignore shared audio sample rate
import { AUDIO_RATE } from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';
export function nativeSeedDeps(auth: { api: ApiClient; getAccessToken(): Promise<string | null>; sessionGeneration(): number }, fallbackTitle: string): SeedDeps {
    const generation = auth.sessionGeneration();
    return {
        online: () => !isOffline(), store: beatStore, ready: () => beatStore.hydrateBeats(), fallbackTitle,
        async currentUserId() {
            const token = await auth.getAccessToken().catch(() => null);
            return auth.sessionGeneration() === generation && token ? userIdFromToken(token) : null;
        },
        getSong: (id, signal) => getSong({ ...auth.api, request: (path, init, options) => auth.api.request(path, { ...init, signal }, options) }, id),
        // Same authenticated signing path as mediaApi(api).getAsset used by useMusicPlayer;
        // called directly so the per-mount AbortSignal reaches this request too.
        sign: (jobId, signal) => auth.api.request(`/api/v1/jobs/${encodeURIComponent(jobId)}/asset`, { signal }),
        fetchAudio: streamFetch as unknown as typeof fetch,
        async decode(bytes) {
            const Context = loadNativeContext();
            const context = new Context({ sampleRate: AUDIO_RATE });
            try {
                return await (context as unknown as { decodeAudioData(bytes: ArrayBuffer): Promise<DecodedAudio> }).decodeAudioData(bytes);
            } finally { await context.close(); }
        },
    };
}
