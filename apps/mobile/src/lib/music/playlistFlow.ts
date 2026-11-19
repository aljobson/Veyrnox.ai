import { ApiError, type ApiClient } from '../api';
import { listSongs } from './client';
import { listPlaylists } from './playlistsClient';
import { createPlaylistAttempts } from './playlistAttempts';
import { isPlaylistUnavailable, playlistFingerprint, scanPlaylist, type PlaylistScan } from './playlistAvailability';
import type { Playlist, PlaylistEdit, PlaylistWrite } from './playlistTypes';
import type { MusicSongRow } from './types';
type State = Readonly<{
    status: 'loading' | 'on' | 'off' | 'error'; playlists: readonly Playlist[];
    busy: boolean; refreshing: boolean; error: string | null; notice: string | null;
    picker: readonly MusicSongRow[] | null; scan: PlaylistScan | null;
}>;
export function createPlaylistFlow(api: ApiClient, id?: string, mint?: () => string) {
    const attempts = createPlaylistAttempts(api, mint);
    let state: State = { status: 'loading', playlists: [], busy: false, refreshing: false, error: null, notice: null, picker: null, scan: null };
    let disposed = false, epoch = 0, read = 0, scanEpoch = 0;
    const listeners = new Set<() => void>();
    const update = (patch: Partial<State>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    const selected = () => state.playlists.find(p => p.id === id);
    function fail(error: unknown) {
        if (isPlaylistUnavailable(error)) update({ status: 'off', scan: null, error: null });
        else update({ error: error instanceof ApiError ? error.code : 'network' });
    }
    async function load() {
        if (disposed) return;
        const token = epoch, ticket = ++read; ++scanEpoch; update({ refreshing: true, scan: null });
        try {
            const playlists = await listPlaylists(api);
            if (disposed || token !== epoch || ticket !== read) return;
            update({ playlists, scan: null, status: 'on', error: null });
        } catch (error) {
            if (disposed || token !== epoch || ticket !== read) return;
            fail(error); if (!isPlaylistUnavailable(error)) update({ status: 'error', scan: null });
        } finally { if (token === epoch && ticket === read) update({ refreshing: false }); }
    }
    async function write(request: PlaylistWrite) {
        if (disposed || state.busy || state.refreshing) return;
        const token = epoch; ++read; update({ busy: true, error: null, notice: null, scan: null });
        try {
            await attempts.run(request);
            if (disposed || token !== epoch) return;
            // Receipts never replace a read: another writer may have advanced even a fresh acknowledgement.
            await load();
            if (!disposed && token === epoch && state.status === 'on') update({ notice: 'saved' });
        } catch (error) {
            if (disposed || token !== epoch) return;
            if (error instanceof ApiError && ['revision_conflict', 'invalid_songs'].includes(error.code)) {
                await load();
                if (token === epoch && state.status !== 'off') update({ error: error.code });
            } else fail(error);
        } finally { if (token === epoch) update({ busy: false }); }
    }
    return {
        snapshot: () => state, selected, attempts,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        load,
        invalidateScan() { ++scanEpoch; update({ scan: null }); },
        create: (title: string) => write({ kind: 'create', title }),
        edit: (edit: PlaylistEdit) => id ? write({ kind: 'patch', id, edit }) : Promise.resolve(),
        retry: () => { const pending = attempts.snapshot(); return pending ? write(pending.write) : load(); },
        async openPicker() {
            if (disposed || state.busy || attempts.snapshot()) return;
            const token = epoch; update({ busy: true, error: null });
            try {
                const picker = await listSongs(api, { limit: 50 });
                if (token === epoch) update({ picker });
            } catch (error) { if (token === epoch) fail(error); }
            finally { if (token === epoch) update({ busy: false }); }
        },
        closePicker: () => update({ picker: null }),
        async scan() {
            const playlist = selected();
            if (disposed || !playlist || state.busy || state.refreshing || attempts.snapshot()) return;
            const token = epoch, fingerprint = playlistFingerprint(playlist), scanToken = ++scanEpoch;
            update({ busy: true, scan: null, error: null, notice: null });
            const current = () => !disposed && token === epoch && scanToken === scanEpoch && state.status === 'on' && !!selected() && fingerprint === playlistFingerprint(selected()!);
            try {
                const scan = await scanPlaylist(api, playlist, current);
                if (current()) update({ scan, notice: scan.unavailable.length ? null : 'noneUnavailable' });
            } catch (error) { if (token === epoch) { update({ scan: null }); fail(error); } }
            finally { if (token === epoch) update({ busy: false }); }
        },
        async removeUnavailable() {
            const playlist = selected(), scan = state.scan;
            if (!playlist || !scan || scan.fingerprint !== playlistFingerprint(playlist)) { update({ error: 'scan_stale', scan: null }); return; }
            if (!scan.unavailable.length) return;
            await write({ kind: 'patch', id: playlist.id, edit: { action: 'replace', expected_revision: playlist.revision,
                song_ids: playlist.songs.filter(s => !scan.unavailable.includes(s.id)).map(s => s.id) } });
        },
        dispose() { disposed = true; ++epoch; ++read; attempts.reset(); state = { ...state, scan: null }; listeners.clear(); },
    };
}
