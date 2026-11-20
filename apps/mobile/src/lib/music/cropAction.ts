import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { subscribeCacheUser } from '../appCache';
import { cropSong, getSong } from './client';
import { parseMusicCrop } from './shared';
import { isMusicOff } from './probe';
import { notifySongChanged } from './songChanges';
import type { MusicSongDetail } from './types';
import type { CropInput, CropResult } from './actionTypes';
// Decimal pads in de/fr/es/pt/ru type a comma; one comma is a decimal separator, anything else stays invalid.
export const normalizeSeconds = (text: string): string => /^\s*[^,]*,[^,]*\s*$/.test(text) ? text.trim().replace(',', '.') : text.trim();
export function cropRangeError(start: string, end: string, duration: number | null): string | null {
    if (!start.trim() || !end.trim()) return 'crop_range_invalid';
    const a = Number(normalizeSeconds(start)), b = Number(normalizeSeconds(end));
    const parsed = parseMusicCrop({ version_id: '00000000-0000-4000-8000-000000000001', start_seconds: a,
        end_seconds: b, idempotency_key: 'range-check' });
    if (!parsed.ok) return parsed.error;
    return duration !== null && b > duration + 0.05 ? 'crop_range_invalid' : null;
}
type State = Readonly<{
    status: 'loading' | 'on' | 'off' | 'error'; song: MusicSongDetail | null; start: string; end: string;
    duration: number | null; busy: boolean; error: string | null; result: CropResult | null; ambiguous: boolean;
}>;
export function createCropAction(api: ApiClient, songId: string, mintKey = randomUUID) {
    const empty: State = { status: 'loading', song: null, start: '0', end: '', duration: null, busy: false, error: null, result: null, ambiguous: false };
    let state = empty, disposed = false, revision = 0;
    let attempt: { key: string; input: CropInput } | null = null;
    const listeners = new Set<() => void>();
    const update = (patch: Partial<State>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    function fail(error: unknown) {
        if (isMusicOff(error)) { attempt = null; update({ ...empty, status: 'off' }); return; }
        const duration = error instanceof ApiError && error.code === 'crop_range_invalid' ? error.body.duration_seconds : null;
        update({ error: error instanceof ApiError ? error.code : 'network',
            ...(typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? { duration } : {}) });
    }
    async function load() {
        if (disposed || state.busy || state.ambiguous) return;
        const ticket = ++revision; update({ busy: true, error: null });
        try {
            const song = await getSong(api, songId);
            if (disposed || ticket !== revision) return;
            if (song.lifecycle_status === 'trashed' || !song.actions.includes('crop')) { update({ ...empty, status: 'off' }); return; }
            attempt = null; update({ status: 'on', song, duration: null });
        } catch (error) { if (!disposed && ticket === revision) { fail(error); if (state.status !== 'off') update({ status: 'error' }); } }
        finally { if (ticket === revision) update({ busy: false }); }
    }
    function dispose() { if (disposed) return; disposed = true; revision++; attempt = null; state = empty; stopAccount(); listeners.forEach(fn => fn()); listeners.clear(); }
    const stopAccount = subscribeCacheUser(dispose);
    return {
        snapshot: () => state, isLive: () => !disposed,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        load, dispose,
        edit(patch: Partial<Pick<State, 'start' | 'end'>>) {
            if (disposed || state.busy) return;
            revision++; attempt = null; update({ ...patch, result: null, error: null, ambiguous: false });
        },
        setDuration(duration: number, versionId: string) {
            if (disposed || versionId !== state.song?.version_id || !Number.isFinite(duration) || duration <= 0) return;
            update({ duration });
        },
        async confirm() {
            if (disposed || state.status !== 'on' || !state.song || state.busy || state.result) return;
            const invalid = cropRangeError(state.start, state.end, state.duration);
            if (!attempt && invalid) { update({ error: invalid }); return; }
            attempt ??= { key: `crop.${mintKey()}`, input: { version_id: state.song.version_id, start_seconds: Number(normalizeSeconds(state.start)), end_seconds: Number(normalizeSeconds(state.end)) } };
            const captured = attempt; update({ busy: true, error: null });
            try {
                const result = await cropSong(api, songId, captured.input, captured.key);
                if (disposed) return;
                attempt = null; update({ result, ambiguous: false }); notifySongChanged();
                // Refresh failure must never turn an acknowledged success into another crop.
                const song = await getSong(api, songId);
                if (!disposed) update({ song, duration: null });
            } catch (error) {
                if (disposed) return;
                // Preserve the same key even on a definitive rejection until the range is edited.
                const definitive = error instanceof ApiError && [400, 404, 409].includes(error.status);
                update({ ambiguous: !state.result && !definitive }); fail(error);
            } finally { update({ busy: false }); }
        },
    };
}
