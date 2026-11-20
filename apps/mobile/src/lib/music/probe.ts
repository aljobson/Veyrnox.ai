import { ApiError } from '../api';

// Music's rollout switches are evaluated inside each route (lib/musicRuntime.js); no route hands the
// flag set to a client. So the phone probes by calling: a 404 with a Music "unavailable" code means
// the feature is off (ADR-0352). Every other failure is an error, never "off".
export type MusicProbe<T> =
    | { readonly state: 'on'; readonly data: T }
    | { readonly state: 'off'; readonly code: string }
    | { readonly state: 'error'; readonly code: string; readonly status: number };

// Codes the routes answer with a 404 when their switch is off. `not_found` is NOT here: it means
// a missing song or hook on a feature that is on.
const OFF_CODES: ReadonlySet<string> = new Set([
    'music_unavailable',
    'playlists_unavailable',
    'blocks_unavailable',
    'music_library_unavailable',
    'music_library_tabs_unavailable',
    'music_remix_unavailable',
]);

export function isMusicOff(err: unknown): boolean {
    if (!(err instanceof ApiError) || err.status !== 404) return false;
    return OFF_CODES.has(err.code) || /^music_[a-z_]+_unavailable$/.test(err.code);
}

// Runs one Music call and folds the result into a state. Never throws.
export async function probeMusic<T>(call: () => Promise<T>): Promise<MusicProbe<T>> {
    try {
        return { state: 'on', data: await call() };
    } catch (err) {
        if (isMusicOff(err)) return { state: 'off', code: (err as ApiError).code };
        if (err instanceof ApiError) return { state: 'error', code: err.code, status: err.status };
        return { state: 'error', code: 'network', status: 0 };
    }
}
