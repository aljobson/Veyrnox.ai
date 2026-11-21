import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { subscribeCacheUser } from '../appCache';
import { ensureOnline } from '../network';
import { getSong } from './client';
import { createExportQuote, startExport, getExport } from './exportClient';
import { markExportUnavailable } from './exportAvailability';
import { isMusicOff } from './probe';
import { shareStemFile } from './stemFiles';
import type { ExportFormat, ExportQuote, ExportStart } from './validateExport';
import type { MusicSongDetail } from './types';
type Attempt = Readonly<{ quote: ExportQuote; key: string; phase: 'UNSUBMITTED' | 'AMBIGUOUS' }>;
type State = Readonly<{
    status: 'loading' | 'idle' | 'reviewing' | 'confirming' | 'ready' | 'saving' | 'error' | 'off';
    song: MusicSongDetail | null; format: ExportFormat; pending: Attempt | null;
    result: ExportStart | null; error: string | null; sheetClosed: boolean;
}>;
const definitive = new Set(['quote_expired', 'download_allowance_exhausted', 'idempotency_conflict', 'not_found',
    'invalid_request', 'invalid_inputs', 'quote_id_invalid', 'idempotency_key_invalid', 'format_unavailable', 'render_required']);
export function createExportFlow(api: ApiClient, songId: string, mintKey = randomUUID) {
    const empty: State = { status: 'loading', song: null, format: 'mp3', pending: null, result: null, error: null, sheetClosed: false };
    let state = empty, disposed = false, revision = 0, busy = false;
    const listeners = new Set<() => void>();
    const update = (patch: Partial<State>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    const current = (ticket: number) => !disposed && revision === ticket;
    function off() { revision++; busy = false; update({ ...empty, status: 'off' }); }
    function fail(error: unknown) {
        if (disposed) return;
        if (isMusicOff(error)) {
            if (error instanceof ApiError && error.code === 'music_distribution_unavailable') markExportUnavailable();
            off(); return;
        }
        update({ status: state.result ? 'ready' : 'error', error: error instanceof ApiError ? error.code : 'network' });
    }
    function dispose() {
        if (disposed) return;
        disposed = true; revision++; stopAccount(); state = empty; listeners.forEach(fn => fn()); listeners.clear();
    }
    const stopAccount = subscribeCacheUser(dispose);
    const eligible = (song: MusicSongDetail) => song.lifecycle_status !== 'trashed' && song.actions.includes('download_mp3');
    return {
        snapshot: () => state, isLive: () => !disposed,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, dispose,
        async load() {
            if (disposed || busy || state.pending?.phase === 'AMBIGUOUS' || state.result) return;
            busy = true; const ticket = ++revision; update({ status: 'loading', error: null, pending: null });
            try {
                const song = await getSong(api, songId);
                if (!current(ticket)) return;
                if (!eligible(song)) { off(); return; }
                // The detail projection has no stored MIME. Default to MP3; never infer it from the action name.
                update({ song, status: 'idle' });
            } catch (error) { if (current(ticket)) fail(error); }
            finally { if (current(ticket)) busy = false; }
        },
        edit(format: ExportFormat) {
            if (disposed || state.status === 'loading' || state.status === 'off' || state.status === 'confirming'
                || state.pending?.phase === 'AMBIGUOUS' || state.result) return;
            revision++; busy = false; update({ format, pending: null, error: null, status: 'idle' });
        },
        async review() {
            if (disposed || busy || !state.song || state.status === 'off' || state.result || state.pending?.phase === 'AMBIGUOUS') return;
            busy = true; const ticket = ++revision, format = state.format;
            update({ status: 'reviewing', pending: null, error: null });
            try {
                const song = await getSong(api, songId);
                if (!current(ticket)) return;
                if (!eligible(song)) { off(); return; }
                const quote = await createExportQuote(api, songId, song.version_id, format);
                if (!current(ticket)) return;
                update({ song, status: 'idle', pending: { quote, key: `export.${mintKey()}`, phase: 'UNSUBMITTED' } });
            } catch (error) { if (current(ticket)) fail(error); }
            finally { if (current(ticket)) busy = false; }
        },
        async confirm() {
            const pending = state.pending;
            if (disposed || busy || !pending || state.result || state.status === 'off') return;
            if (pending.phase === 'UNSUBMITTED' && Date.parse(pending.quote.expires_at) <= Date.now()) {
                update({ pending: null, error: 'quote_expired', status: 'error' }); return;
            }
            busy = true; const ticket = revision; update({ status: 'confirming', error: null });
            try {
                await ensureOnline();
                if (!current(ticket)) return;
                update({ pending: { ...pending, phase: 'AMBIGUOUS' } });
                const result = await startExport(api, songId, pending.quote.id, pending.key);
                if (current(ticket)) update({ result, pending: null, status: 'ready' });
            } catch (error) {
                if (!current(ticket)) return;
                if (error instanceof ApiError && [400, 402, 404, 409, 413, 503].includes(error.status) && definitive.has(error.code)) update({ pending: null });
                fail(error);
            } finally { if (current(ticket)) busy = false; }
        },
        async save() {
            const result = state.result;
            if (disposed || busy || !result || state.status === 'off') return;
            busy = true; const ticket = revision; update({ status: 'saving', error: null, sheetClosed: false });
            try {
                const file = await getExport(api, result.export.id, state.format);
                if (!current(ticket)) return;
                await shareStemFile({ url: file.url, mimeType: file.mime_type, sizeBytes: file.size_bytes,
                    requestId: result.export.id, kind: 'export', isCurrent: () => current(ticket) });
                if (current(ticket)) update({ status: 'ready', sheetClosed: true });
            } catch (error) { if (current(ticket)) fail(error); }
            finally { if (current(ticket)) busy = false; }
        },
    };
}
