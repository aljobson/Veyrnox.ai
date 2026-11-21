import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { subscribeCacheUser } from '../appCache';
import { ensureOnline, OfflineError } from '../network';
import { getSong } from './client';
import { renderSong } from './renderClient';
import { initialRenderForm, renderFormError, renderInput, type RenderForm, type RenderInput } from './renderForm';
import { renderAvailability, markRenderUnavailable } from './renderAvailability';
import { isDefinitiveRenderError } from './renderMessages';
import { notifySongChanged } from './songChanges';
import type { MusicSongDetail } from './types';
import type { RenderResult } from './validateRender';

export type RenderState = Readonly<{
    status: 'loading' | 'on' | 'off' | 'error'; song: MusicSongDetail | null; form: RenderForm; duration: number | null;
    busy: boolean; ambiguous: boolean; error: string | null; result: RenderResult | null; refreshed: boolean;
}>;
export const canPlayRenderResult = (state: RenderState) => state.refreshed && !!state.result
    && state.song?.version_id === state.result.version_id && state.song.lifecycle_status !== 'trashed';
export function createRenderFlow(api: ApiClient, songId: string, mintKey = randomUUID) {
    const empty: RenderState = { status: 'loading', song: null, form: initialRenderForm, duration: null,
        busy: false, ambiguous: false, error: null, result: null, refreshed: false };
    let state = empty, disposed = false, revision = 0;
    let attempt: { key: string; input: RenderInput } | null = null;
    const listeners = new Set<() => void>();
    const update = (patch: Partial<RenderState>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    function fail(error: unknown) {
        const code = error instanceof ApiError ? error.code : error instanceof OfflineError ? 'offline' : 'network';
        if (error instanceof ApiError && error.status === 404) {
            if (code === 'music_editing_unavailable') markRenderUnavailable('editing');
            if (code === 'music_reverse_unavailable') markRenderUnavailable('reverse');
        }
        update({ error: code, ...(code === 'music_editing_unavailable' || code === 'music_unavailable' ? { status: 'off' as const } : {}) });
    }
    function setDuration(seconds: number, version: string) {
        if (disposed || state.result || version !== state.song?.version_id || !Number.isFinite(seconds) || seconds <= 0) return;
        update({ duration: seconds });
    }
    async function refreshResult() {
        const song = await getSong(api, songId);
        if (!disposed) update({ song, duration: null, refreshed: true });
    }
    function dispose() {
        if (disposed) return;
        disposed = true; revision++; attempt = null; stopAccount(); state = empty;
        listeners.forEach(fn => fn()); listeners.clear();
    }
    const stopAccount = subscribeCacheUser(dispose);
    return {
        snapshot: () => state, isLive: () => !disposed,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        dispose, setDuration,
        async load() {
            if (disposed || state.busy || state.ambiguous || state.result) return;
            const ticket = ++revision; update({ status: 'loading', busy: true, error: null });
            try {
                const song = await getSong(api, songId);
                if (disposed || ticket !== revision) return;
                const allowed = renderAvailability().editing && song.lifecycle_status !== 'trashed' && song.actions.includes('render');
                attempt = null;
                update({ status: allowed ? 'on' : 'off', song, duration: null });
            } catch (error) {
                if (!disposed && ticket === revision) { update({ status: 'error' }); fail(error); }
            } finally { if (ticket === revision) update({ busy: false }); }
        },
        edit(patch: Partial<RenderForm>) {
            if (disposed || state.busy || state.ambiguous || state.result) return;
            const form = { ...state.form, ...patch };
            if (form.operation === 'reverse' && (!state.song?.actions.includes('reverse') || !renderAvailability().reverse)) return;
            attempt = null; update({ form, error: null });
        },
        async refresh() {
            if (disposed || !state.result || state.busy) return;
            update({ busy: true, error: null, refreshed: false });
            try { await refreshResult(); } catch { update({ error: 'refresh_failed' }); }
            finally { update({ busy: false }); }
        },
        async confirm() {
            if (disposed || state.status !== 'on' || !state.song || state.busy || state.result || !renderAvailability().editing) return;
            if (!attempt && state.form.operation === 'reverse' && (!state.song.actions.includes('reverse') || !renderAvailability().reverse)) return;
            const invalid = renderFormError(state.form, state.song.version_id, state.duration);
            if (!attempt && invalid) { update({ error: invalid }); return; }
            update({ busy: true, error: null });
            let sent = false;
            try {
                await ensureOnline();
                if (disposed) return;
                attempt ??= { key: `render.${mintKey()}`, input: renderInput(state.form, state.song!.version_id) };
                const captured = attempt;
                sent = true; update({ ambiguous: true });
                const result = await renderSong(api, songId, captured.input, captured.key);
                if (disposed) return;
                attempt = null; update({ result, ambiguous: false, refreshed: false });
                notifySongChanged();
                // A failed refresh must never turn an acknowledged render into a second POST.
                try { await refreshResult(); } catch { update({ error: 'refresh_failed' }); }
            } catch (error) {
                if (disposed) return;
                if (sent && isDefinitiveRenderError(error)) {
                    const version = attempt?.input.version_id;
                    if (error instanceof ApiError && ['fade_range_invalid', 'reorder_range_invalid'].includes(error.code)
                        && typeof error.body.duration_seconds === 'number' && version) setDuration(error.body.duration_seconds, version);
                    attempt = null; update({ ambiguous: false });
                }
                fail(error);
            } finally { update({ busy: false }); }
        },
    };
}
export type RenderFlow = ReturnType<typeof createRenderFlow>;
