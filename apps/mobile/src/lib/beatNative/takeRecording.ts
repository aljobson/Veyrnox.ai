import type { BeatAudio } from './audio';
import type { BeatDoc } from './doc';
import { drainNativeCapture, openNativeCapture, requestTakePermission, takeAudioSession } from './nativeCapture';
import { replacementUnderway } from './recordingFinalizers';
import {
    assertBeatWritable, audioRecordingRange, BEAT_TAKE_BYTES, beatTakeBytes, commitRecording, createAudioRecording,
    discardBeatTakes, documentHasTake, hydrateBeatTakes, loadBeatTake, pendingBeatTakes, readLatency, reconcileBeatTakes,
    recordingCapacity, recordingDurationLimit, takeAsset, type Capture, type RecordingEdit, type RecordingState, type Session, type SongWindow, type SyncStorage, type TakeRow,
} from './takeShared';
export type TakeRecordingView = RecordingState & { armedId: string | null; denied: boolean; recovery: TakeRow[]; recoveryFailed: boolean };
export type RecordingDeps = {
    saved?(): BeatDoc | undefined;
    current(): BeatDoc; audio(): BeatAudio | null; edit: RecordingEdit; storage: SyncStorage;
    t(key: string, params?: Record<string, number | string>): string;
    permission?: typeof requestTakePermission; capture?: typeof openNativeCapture; audioSession?: typeof takeAudioSession;
    drain?: typeof drainNativeCapture;
};
const sessionKeys: Record<string, string> = {
    'app.music.beat.details.d27': 'beatTakes.takeLimit',
    'app.music.beat.details.d35': 'beatTakes.recorded',
    'app.music.beat.details.d36': 'beatTakes.sizeLimit',
    'app.music.beat.details.d37': 'beatTakes.recordingLimit',
    'app.music.beat.details.d38': 'beatTakes.shortPass',
    'app.music.beat.details.d39': 'beatTakes.earlyStop',
    'app.music.beat.compat.readOnly': 'beatTakes.readOnly',
};
export const recordingTranslator = (translate: RecordingDeps['t']): RecordingDeps['t'] =>
    (key, params) => translate(sessionKeys[key] ?? (key.startsWith('app.music.') ? 'beatTakes.error' : key), params);
export function createTakeRecording(deps: RecordingDeps) {
    let state: TakeRecordingView = { status: 'idle', seconds: 0, pass: 1, error: '', armedId: null, denied: false, recovery: [], recoveryFailed: false };
    const listeners = new Set<() => void>();
    let input: Capture | null = null, session: Session | null = null, intent = 0, opening: Promise<void> | null = null;
    let transport: BeatAudio | null = null;
    let finishing: Promise<void> | null = null, disposed = false;
    const show = (patch: Partial<TakeRecordingView>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
    const fail = (key = 'beatTakes.error') => show({ error: deps.t(key) });
    const locked = () => ['opening', 'recording', 'finishing'].includes(state.status);
    async function release() {
        const old = input; input = null;
        try { await old?.close(); } finally { if (old) (deps.audioSession ?? takeAudioSession)(false); show({ armedId: null, status: session?.error ? 'error' : 'idle' }); }
    }
    const api = {
        activate() { disposed = false; },
        snapshot: () => state,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        locked, capture: () => input,
        async refreshRecovery(saved = deps.saved?.()) {
            try { if (saved) await reconcileBeatTakes(saved); else await hydrateBeatTakes(); show({ recovery: pendingBeatTakes(deps.current().id), recoveryFailed: false, error: '' }); }
            catch { show({ recoveryFailed: true }); fail('beatTakes.recoveryError'); }
        },
        async arm(trackId: string | null) {
            if (locked() || session?.error || disposed || replacementUnderway(deps.current().id)) return;
            const token = ++intent;
            show({ status: 'opening', error: '', denied: false });
            opening = (async () => {
                await release();
                if (!trackId) return;
                try {
                    assertBeatWritable(deps.current());
                    if (!deps.current().tracks.some(t => t.id === trackId && t.kind === 'audio')) return;
                    show({ status: 'opening' });
                    if (!await (deps.permission ?? requestTakePermission)()) { show({ denied: true, status: 'idle' }); fail('beatTakes.permissionDenied'); return; }
                    if (token !== intent || disposed) return;
                    (deps.audioSession ?? takeAudioSession)(true);
                    const engine = deps.audio()?.recordingEngine?.(); if (!engine) throw new Error('no_engine');
                    await engine.resume();
                    const opened = await (deps.capture ?? openNativeCapture)(engine.context, { onEnded: () => {
                        void api.finishAndDisarm().then(() => fail('beatTakes.disconnected')).catch(() => fail());
                    } });
                    if (token !== intent || disposed || opened.ended) { await opened.close(); (deps.audioSession ?? takeAudioSession)(false); return; }
                    input = opened; assertBeatWritable(deps.current());
                    show({ armedId: trackId, status: 'armed' });
                } catch { await release(); (deps.audioSession ?? takeAudioSession)(false); show({ status: 'error' }); fail(); }
            })();
            await opening; opening = null;
        },
        async record(countIn: boolean) {
            if (!input || !state.armedId || locked() || session?.error || replacementUnderway(deps.current().id)) return;
            const capture = input, trackId = state.armedId, token = ++intent;
            show({ status: 'opening', error: '' });
            opening = (async () => {
                try {
                    const doc = deps.current(); assertBeatWritable(doc); await hydrateBeatTakes();
                    if (token !== intent || disposed) return;
                    const range = audioRecordingRange(doc, doc.cycle?.on ? doc.cycle.start : 0);
                    const available = (BEAT_TAKE_BYTES - beatTakeBytes()) / (capture.context.sampleRate * 4);
                    if (available < 1) throw new Error('take_storage_full');
                    range.maxSeconds = Math.min(600, available);
                    const capacity = recordingCapacity(doc, trackId, { start: range.start, length: range.cycle ? range.length : 240, single: !range.cycle, preflight: !range.cycle });
                    if (!capacity.lanes) throw new Error(capacity.reason);
                    const limit = recordingDurationLimit(range, doc.tempo.bpm, capture.context.sampleRate, capacity.lanes);
                    const audio = deps.audio(); if (!audio?.playRange) throw new Error('no_transport');
                    transport = audio;
                    const windows: SongWindow[] = [];
                    const { contextStart } = await audio.playRange({ getDoc: deps.current, startTick: range.start,
                        endTick: range.cycle ? range.start + range.length : Math.min(range.start + range.length, range.start + limit.seconds * doc.tempo.bpm * 16),
                        cycle: range.cycle ? { start: range.start, end: range.start + range.length } : null, countInBars: countIn ? 1 : 0,
                        onWindow: w => session ? session.window(w) : windows.push(w) });
                    if (token !== intent || disposed) { audio.stop(); return; }
                    session = createAudioRecording({ doc, trackId, range, capture, contextStart, countIn,
                        rtt: (readLatency(capture.deviceId, deps.storage)?.ms ?? 0) / 1000,
                        current: deps.current, edit: deps.edit, t: recordingTranslator(deps.t), drain: deps.drain ?? drainNativeCapture,
                        announce: message => show({ error: message === session?.error ? deps.t('beatTakes.saveError') : message }), onState: patch => show({ ...patch, ...(patch.error ? { error: deps.t('beatTakes.saveError') } : {}) }),
                        stop: () => api.finish(), onSettled: () => { session = null; } });
                    windows.forEach(w => session?.window(w)); show({ status: 'recording', seconds: 0, pass: 1 });
                } catch { transport?.stop(); transport = null; show({ status: 'error' }); fail(); }
            })();
            await opening; opening = null;
        },
        async finish() {
            if (finishing) return finishing;
            finishing = (async () => {
                await opening;
                transport?.stop(); transport = null;
                if (session && !session.finishing) show({ status: 'finishing' });
                await session?.finish();
            })();
            try { await finishing; } finally { finishing = null; }
        },
        async finishAndDisarm() {
            ++intent; await api.finish(); await release();
        },
        async beforeReplace() {
            if (['recording', 'finishing'].includes(state.status) || transport) await api.finishAndDisarm();
            else if (opening) { ++intent; await opening; show({ status: input ? 'armed' : 'idle' }); }
            if (session?.error) throw new Error('recording_not_preserved');
        },
        async recover(discard = false) {
            if (locked() || replacementUnderway(deps.current().id)) return;
            try {
                if (discard) await discardBeatTakes(state.recovery.map(r => r.id));
                else {
                    assertBeatWritable(deps.current());
                    const groups = new Map<string, TakeRow[]>();
                    for (const row of state.recovery) if (row.pending && !documentHasTake(deps.current(), row)) {
                        const key = row.pending.recordingId; groups.set(key, [...(groups.get(key) ?? []), row]);
                    }
                    for (const rows of groups.values()) {
                        rows.sort((a, b) => a.pending!.pass - b.pending!.pass);
                        const loaded = await Promise.all(rows.map(row => loadBeatTake(row.id)));
                        if (loaded.some(row => !row)) throw new Error('take_read_failed');
                        const { trackId, start, length, cycle } = rows[0].pending!;
                        if (!deps.edit(d => commitRecording(d, { trackId, start, length, single: !cycle, takes: loaded.map(row => ({ asset: takeAsset(row!) })) }),
                            { recordingCommit: true, label: deps.t('beatTakes.recovered') })) throw new Error('recovery_failed');
                    }
                }
                show({ recovery: [], recoveryFailed: false, error: '' });
            } catch { show({ recoveryFailed: true }); fail('beatTakes.recoveryError'); }
        },
        async retry() {
            if (session?.error) await session.retry();
            else await api.refreshRecovery();
        },
        async discard() { await session?.discard(); session = null; show({ error: '', status: input ? 'armed' : 'idle' }); },
        async dispose() { disposed = true; await api.finishAndDisarm(); listeners.clear(); },
    };
    return api;
}
export type TakeRecording = ReturnType<typeof createTakeRecording>;
