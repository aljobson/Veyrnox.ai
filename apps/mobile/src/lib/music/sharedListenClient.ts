import { ApiError } from '../api';
import { config } from '../config';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { isSharedSong, listenToken, type SharedSong } from './validateShared';
// No authenticated client, identity headers, cache, telemetry or response URLs retained.
export async function getSharedSong(token: string, signal?: AbortSignal, doFetch: typeof fetch = fetch): Promise<SharedSong> {
    if (!listenToken(token)) throw new ApiError(404, 'not_found');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ApiError(0, 'network')); }, 30_000);
    });
    const read = async () => {
        const response = await fetchWithTimeout(doFetch, `${config.apiBase}/api/music/shared/${token}`, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: combined });
        if (response.status === 404) throw new ApiError(404, 'not_found');
        if (!response.ok) throw new ApiError(response.status, 'shared_unavailable');
        const value: unknown = await response.json();
        if (!isSharedSong(value, token)) throw new ApiError(200, 'bad_response');
        // Keep only the validated projection, never arbitrary response fields.
        return value.song;
    };
    try { return await Promise.race([read(), deadline]); }
    catch (error) {
        if (error instanceof ApiError) throw error;
        // Native transport errors can embed the secret URL. Never forward their message/cause.
        throw new ApiError(0, 'network');
    } finally { clearTimeout(timer); }
}
