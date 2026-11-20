import { ApiError, type ApiClient } from '../api';
import { probeMusic } from '../music/probe';
import { createBeatCloud, type CloudOptions } from './cloud';
export type BeatProbe = { state: 'on' | 'off' | 'offline' | 'error' | 'signed_out' };
/** Collection 404 means disabled; an item 404 alone never establishes deletion. */
export async function probeBeatCloud(api: ApiClient, options?: CloudOptions): Promise<BeatProbe> {
    const result = await probeMusic(async () => {
        try { return await createBeatCloud(api).list(options); }
        catch (error) {
            if (error instanceof ApiError && (error.status === 404 || /_unavailable$/i.test(error.code))) throw new ApiError(404, 'music_unavailable');
            throw error;
        }
    });
    if (result.state === 'error' && result.status === 401) return { state: 'signed_out' };
    return { state: result.state === 'error' && result.status === 0 ? 'offline' : result.state };
}
export const probeBeats = probeBeatCloud;
