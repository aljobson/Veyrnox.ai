import type { ApiClient } from '../api';
import { probeMusic, type MusicProbe } from '../music/probe';

/** Probe by call, not by flag: the beat routes sit behind server switches the phone cannot read. A 404 "unavailable" means off. */
export function probeBeats(api: ApiClient): Promise<MusicProbe<unknown>> {
    return probeMusic(() => api.request<unknown>('/api/v1/music/beat-projects'));
}
