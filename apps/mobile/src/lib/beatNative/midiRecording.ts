import { accountBeatFiles } from './persist';
import { assertBeatWritable } from './takeShared';
import type { BeatAudio } from './audio';
import type { BeatDoc } from './doc';
import type { MidiSoundTrack, MidiTrackDoc } from './midi';
import { beatFingerprint, createMidiPendingStore, type MidiPendingStore, type MidiPreparedEnvelope, type MidiTake } from './midiPending';
// @ts-ignore shared JavaScript; these are the single web/native capture and commit reducers.
import * as shared from '../../../../../app/veyrnox/_lib/music/beat/beatRecording.mjs';

type SharedCapture = {
    take: MidiTake;
    accepting: boolean;
    error: string | null;
    on(key: string, pitch: number, velocity: number, tick: number): boolean;
    off(key: string, tick: number): void;
    update(tick: number): void;
    finalize(doc: BeatDoc, tick: number, apply: (next: BeatDoc, count: number) => boolean): BeatDoc;
};
const { createRecording, commitTake, takeAsNewBeat, recordingEndTick, contextTimeToSongTick } = shared as unknown as {
    createRecording(doc: BeatDoc, trackId: string, startTick: number, options?: { snap?: number; announce?: (message: string) => void }): SharedCapture;
    commitTake(doc: BeatDoc, take: MidiTake, now?: number, announce?: (message: string) => void): BeatDoc;
    takeAsNewBeat(source: BeatDoc, take: MidiTake, options: { id: string; now?: number }): BeatDoc;
    recordingEndTick(bpm: number): number;
    contextTimeToSongTick(map: { contextStart: number; startTick?: number; tempo: number; cycle?: { start: number; end: number } | null }, time: number): number;
};

export type MidiRecordingStatus = 'idle' | 'starting' | 'countIn' | 'recording' | 'finishing' | 'recovery' | 'conflict' | 'error';
export type MidiRecordingSnapshot = {
    status: MidiRecordingStatus;
    noteCount: number;
    countInBeat: 0 | 1 | 2 | 3 | 4;
    error: string;
    pending: MidiPreparedEnvelope | null;
};
export type MidiRecordingStart = { trackId: string; startTick: number; snap: number; countInBars: 0 | 1 };
export type MidiRecordingCommit = (doc: BeatDoc, noteCount: number) => boolean;
export type MidiRecordingDeps = {
    beatId: string;
    owner(): string | null | undefined;
    generation(): number;
    current(): BeatDoc | undefined;
    audio(): BeatAudio | null;
    commit: MidiRecordingCommit;
    flush(id: string): Promise<void>;
    readSaved(id: string): Promise<BeatDoc | undefined>;
    getBeat?(id: string): BeatDoc | undefined;
    addBeatFromDocument?(doc: BeatDoc, owner: string): boolean;
    newBeatId?(): string;
    files?(owner: string): ReturnType<typeof accountBeatFiles.forOwner>;
    announce?(message: string): void;
    setTimer?(fn: () => void, ms: number): unknown;
    clearTimer?(timer: unknown): void;
};

export type MidiRecordingErrorCode = 'recording_busy' | 'account_required' | 'account_changed' | 'beat_unavailable'
    | 'midi_track_required' | 'audio_unavailable' | 'recording_conflict' | 'recording_source_mismatch'
    | 'recording_commit_failed' | 'recording_not_recoverable';
export class MidiRecordingError extends Error {
    constructor(readonly code: MidiRecordingErrorCode, cause?: unknown) { super(code, cause === undefined ? undefined : { cause }); this.name = 'MidiRecordingError'; }
}

export function createMidiRecording(deps: MidiRecordingDeps) {
    const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
    const filesFor = deps.files ?? (owner => accountBeatFiles.forOwner(owner));
    const listeners = new Set<() => void>();
    let snapshot: MidiRecordingSnapshot = { status: 'idle', noteCount: 0, countInBeat: 0, error: '', pending: null };
    let intent = 0, timer: unknown = null, capture: SharedCapture | null = null, pendingStore: MidiPendingStore | null = null;
    let activeMutation: Promise<unknown> | null = null;
    let loadingRecovery = false;
    let usedAudio: BeatAudio | null = null;
    let identity: { owner: string; generation: number; intent: number } | null = null;
    let mapping: { contextStart: number; startTick: number; tempo: number; cycle: { start: number; end: number } | null } | null = null;
    const capturedKeys = new Set<string>();
    const takeMatchesSource = (take: MidiTake, doc: BeatDoc | undefined) => {
        const track = doc?.tracks.find(item => item.id === take.trackId) as MidiTrackDoc | undefined;
        return track?.kind === 'midi' && track.name === take.name
            && track.instrument.engine === take.instrument.engine
            && track.instrument.id === take.instrument.id
            && track.instrument.preset === take.instrument.preset;
    };
    const emit = (patch?: Partial<MidiRecordingSnapshot>) => {
        if (patch) snapshot = { ...snapshot, ...patch };
        listeners.forEach(listener => listener());
    };
    const stopTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
    const isCurrent = (found = identity) => !!found && found.intent === intent && deps.owner() === found.owner && deps.generation() === found.generation;
    const assertCurrent = (found = identity) => { if (!isCurrent(found)) throw new MidiRecordingError('account_changed'); };
    const conflictStatus = (error: unknown): MidiRecordingStatus => ['recording_conflict', 'recording_source_mismatch'].includes((error as MidiRecordingError)?.code)
        ? 'conflict' : 'recovery';
    const tickAt = (time: number) => mapping ? contextTimeToSongTick(mapping, time) : 0;
    const acquireAudio = () => { const audio = deps.audio(); if (audio) usedAudio = audio; return audio; };
    const release = () => { capturedKeys.clear(); usedAudio?.releaseKeys?.(); };
    const stopTransport = () => { stopTimer(); usedAudio?.stop(); release(); };
    const fail = (error: unknown) => {
        stopTransport();
        const message = error instanceof Error ? error.message : String(error);
        emit({ status: capture?.take.notes.length || snapshot.pending ? 'recovery' : 'error', error: message, countInBeat: 0 });
    };
    const runMutation = <T>(work: () => Promise<T>): Promise<T> => {
        if (activeMutation) return activeMutation as Promise<T>;
        const task = Promise.resolve().then(work);
        const tracked = task.finally(() => {
            if (activeMutation === tracked) { activeMutation = null; emit({}); }
        });
        activeMutation = tracked;
        emit({});
        return tracked;
    };
    const trackCleanup = (running: Promise<unknown> | null, cleanup: Promise<void> | undefined) => {
        const joined = Promise.allSettled([running, cleanup]).then(results => {
            if (cleanup && results[1]?.status === 'rejected') throw results[1].reason;
        });
        const tracked = joined.finally(() => {
            if (activeMutation === tracked) { activeMutation = null; emit({}); }
        });
        activeMutation = tracked;
        emit({});
        return tracked;
    };
    const armTimer = () => {
        stopTimer();
        const poll = () => {
            timer = null;
            if (!mapping || !capture || !isCurrent() || !['countIn', 'recording'].includes(snapshot.status)) return;
            const now = usedAudio?.now?.();
            if (now === undefined) return fail(new MidiRecordingError('audio_unavailable'));
            if (now >= mapping.contextStart) {
                capture.update(tickAt(now));
                if (snapshot.status !== 'recording') emit({ status: 'recording', countInBeat: 0 });
            } else {
                const bpm = mapping.tempo, elapsed = Math.max(0, now - (mapping.contextStart - 4 * 60 / bpm));
                emit({ countInBeat: Math.min(4, Math.floor(elapsed / (60 / bpm)) + 1) as 1 | 2 | 3 | 4 });
            }
            timer = setTimer(poll, 25);
        };
        timer = setTimer(poll, 0);
    };
    const storeFor = (owner: string, generation: number, operationIntent: number) => createMidiPendingStore(filesFor(owner), {
        owner, beatId: deps.beatId, isCurrent: () => deps.owner() === owner && deps.generation() === generation && intent === operationIntent,
    });
    const prepareAgainst = async (take: MidiTake, base: BeatDoc, target: MidiPreparedEnvelope['target']) => {
        const found = identity!; assertCurrent(found);
        const baseFingerprint = await beatFingerprint(base); assertCurrent(found);
        const baseContentFingerprint = await beatFingerprint(base, { excludeLiveMix: true }); assertCurrent(found);
        let expected = base, refusal: unknown;
        try { expected = commitTake(base, take); } catch (error) { refusal = error; }
        const expectedFingerprint = refusal ? `${baseFingerprint[0] === 'f' ? 'e' : 'f'}${baseFingerprint.slice(1)}` : await beatFingerprint(expected);
        const expectedContentFingerprint = refusal ? `${baseContentFingerprint[0] === 'f' ? 'e' : 'f'}${baseContentFingerprint.slice(1)}`
            : await beatFingerprint(expected, { excludeLiveMix: true });
        assertCurrent(found);
        const envelope = await pendingStore!.prepare({ take, baseFingerprint, expectedFingerprint, baseContentFingerprint, expectedContentFingerprint, target });
        assertCurrent(found);
        emit({ pending: envelope });
        if (refusal) throw refusal;
        return { expected, envelope };
    };
    async function durableExisting(take: MidiTake, sharedCapture?: SharedCapture): Promise<BeatDoc> {
        const found = identity!;
        for (;;) {
            assertCurrent(found);
            const base = deps.current();
            if (!base || base.id !== deps.beatId) throw new MidiRecordingError('beat_unavailable');
            if (!takeMatchesSource(take, base)) throw new MidiRecordingError('recording_source_mismatch');
            assertBeatWritable(base);
            const { expected, envelope } = await prepareAgainst(take, base, { kind: 'existing', beatId: deps.beatId });
            const latest = deps.current(); assertCurrent(found);
            if (!latest || latest.id !== base.id) throw new MidiRecordingError('beat_unavailable');
            const latestFingerprint = await beatFingerprint(latest); assertCurrent(found);
            if (deps.current() !== latest || latestFingerprint !== envelope.baseFingerprint) continue;
            let applied = false;
            if (expected !== base) {
                if (sharedCapture) sharedCapture.finalize(latest, take.notes.reduce((last, note) => Math.max(last, note.end), take.startTick), (next, count) => {
                    applied = deps.commit(next, count); return applied;
                });
                else applied = deps.commit(expected, take.notes.length);
                if (!applied) throw new MidiRecordingError('recording_commit_failed');
            }
            assertCurrent(found);
            await deps.flush(deps.beatId); assertCurrent(found);
            const saved = await deps.readSaved(deps.beatId); assertCurrent(found);
            const savedContent = saved && await beatFingerprint(saved, { excludeLiveMix: true }); assertCurrent(found);
            if (!saved || savedContent !== envelope.expectedContentFingerprint) throw new MidiRecordingError('recording_commit_failed');
            await pendingStore!.remove(); assertCurrent(found);
            emit({ pending: null });
            return deps.current() ?? expected;
        }
    }
    async function restoreEnvelope(envelope: MidiPreparedEnvelope, snap?: number): Promise<void> {
        const found = identity!; assertCurrent(found);
        const take = snap === undefined ? envelope.take : { ...envelope.take, snap };
        if (envelope.target.kind === 'existing' && !takeMatchesSource(take, deps.current())) {
            throw new MidiRecordingError('recording_source_mismatch');
        }
        if (envelope.target.kind === 'new') {
            const saved = await deps.readSaved(envelope.target.beatId); assertCurrent(found);
            const savedContent = saved && await beatFingerprint(saved, { excludeLiveMix: true }); assertCurrent(found);
            if (saved && savedContent === envelope.expectedContentFingerprint) { await pendingStore!.remove(); emit({ status: 'idle', pending: null, error: '' }); return; }
            const existing = deps.getBeat?.(envelope.target.beatId);
            if (existing) {
                const existingContent = await beatFingerprint(existing, { excludeLiveMix: true }); assertCurrent(found);
                if (deps.getBeat?.(existing.id) !== existing || existingContent !== envelope.expectedContentFingerprint) throw new MidiRecordingError('recording_conflict');
                await deps.flush(existing.id); assertCurrent(found);
                const durable = await deps.readSaved(existing.id); assertCurrent(found);
                const durableContent = durable && await beatFingerprint(durable, { excludeLiveMix: true }); assertCurrent(found);
                if (!durable || durableContent !== envelope.expectedContentFingerprint) throw new MidiRecordingError('recording_commit_failed');
                await pendingStore!.remove(); emit({ status: 'idle', pending: null, error: '' }); return;
            }
            if (!deps.addBeatFromDocument) throw new MidiRecordingError('recording_conflict');
            for (;;) {
                const source = deps.current();
                if (!source) throw new MidiRecordingError('recording_conflict');
                if (!takeMatchesSource(take, source)) throw new MidiRecordingError('recording_source_mismatch');
                const sourceContent = await beatFingerprint(source, { excludeLiveMix: true }); assertCurrent(found);
                if (deps.current() !== source) continue;
                if (sourceContent !== envelope.baseContentFingerprint) throw new MidiRecordingError('recording_conflict');
                const next = takeAsNewBeat(source, take, { id: envelope.target.beatId, now: envelope.createdAt });
                const nextContent = await beatFingerprint(next, { excludeLiveMix: true }); assertCurrent(found);
                if (deps.current() !== source) continue;
                if (nextContent !== envelope.expectedContentFingerprint) throw new MidiRecordingError('recording_conflict');
                if (!deps.addBeatFromDocument(next, found.owner)) throw new MidiRecordingError('recording_commit_failed');
                await deps.flush(next.id); assertCurrent(found);
                const durable = await deps.readSaved(next.id); assertCurrent(found);
                const durableContent = durable && await beatFingerprint(durable, { excludeLiveMix: true }); assertCurrent(found);
                if (!durable || durableContent !== envelope.expectedContentFingerprint) throw new MidiRecordingError('recording_commit_failed');
                await pendingStore!.remove(); emit({ status: 'idle', pending: null, error: '' }); return;
            }
        }
        const saved = await deps.readSaved(deps.beatId); assertCurrent(found);
        const savedContent = saved && await beatFingerprint(saved, { excludeLiveMix: true }); assertCurrent(found);
        if (saved && savedContent === envelope.expectedContentFingerprint) {
            await pendingStore!.remove(); emit({ status: 'idle', pending: null, error: '' }); return;
        }
        const current = deps.current();
        if (!current) throw new MidiRecordingError('recording_conflict');
        assertBeatWritable(current);
        const currentContentFingerprint = await beatFingerprint(current, { excludeLiveMix: true }); assertCurrent(found);
        if (currentContentFingerprint === envelope.expectedContentFingerprint) {
            await deps.flush(deps.beatId); assertCurrent(found);
            const durable = await deps.readSaved(deps.beatId); assertCurrent(found);
            const durableContent = durable && await beatFingerprint(durable, { excludeLiveMix: true }); assertCurrent(found);
            if (!durable || durableContent !== envelope.expectedContentFingerprint) throw new MidiRecordingError('recording_commit_failed');
            await pendingStore!.remove(); emit({ status: 'idle', pending: null, error: '' }); return;
        }
        if (currentContentFingerprint !== envelope.baseContentFingerprint) throw new MidiRecordingError('recording_conflict');
        await durableExisting(take);
        emit({ status: 'idle', error: '' });
    }
    const controller = {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        snapshot: () => snapshot,
        locked: () => loadingRecovery || !!activeMutation || !['idle', 'error'].includes(snapshot.status) || !!snapshot.pending,
        async refreshRecovery() {
            if (loadingRecovery || activeMutation || capture || !['idle', 'error'].includes(snapshot.status)) throw new MidiRecordingError('recording_busy');
            const owner = deps.owner();
            if (!owner) { emit({ pending: null }); return null; }
            const generation = deps.generation(), operationIntent = ++intent;
            identity = { owner, generation, intent: operationIntent };
            pendingStore = storeFor(owner, generation, operationIntent);
            loadingRecovery = true; emit({});
            try {
                const pending = await pendingStore.read(); assertCurrent();
                const compatible = !pending || takeMatchesSource(pending.take, deps.current());
                emit({ pending, status: pending ? compatible ? 'recovery' : 'conflict' : 'idle', error: compatible ? '' : 'recording_source_mismatch' });
                return pending;
            } finally { loadingRecovery = false; emit({}); }
        },
        async start(options: MidiRecordingStart) {
            if (loadingRecovery || activeMutation || !['idle', 'error'].includes(snapshot.status) || snapshot.pending) throw new MidiRecordingError('recording_busy');
            const owner = deps.owner(); if (!owner) throw new MidiRecordingError('account_required');
            const doc = deps.current(); if (!doc || doc.id !== deps.beatId) throw new MidiRecordingError('beat_unavailable');
            assertBeatWritable(doc);
            const track = doc.tracks.find(item => item.id === options.trackId);
            if (track?.kind !== 'midi') throw new MidiRecordingError('midi_track_required');
            const audio = acquireAudio(); if (!audio?.playRange) throw new MidiRecordingError('audio_unavailable');
            const operationIntent = ++intent, generation = deps.generation();
            identity = { owner, generation, intent: operationIntent };
            pendingStore = storeFor(owner, generation, operationIntent);
            capture = createRecording(doc, options.trackId, options.startTick, { snap: options.snap, announce: deps.announce });
            mapping = null; capturedKeys.clear();
            emit({ status: 'starting', noteCount: 0, countInBeat: 0, error: '', pending: null });
            try {
                const cycle = doc.cycle.on ? { start: doc.cycle.start, end: doc.cycle.end } : null;
                const started = await audio.playRange({ getDoc: deps.current, startTick: options.startTick,
                    endTick: recordingEndTick(doc.tempo.bpm), cycle, countInBars: options.countInBars,
                    assetMode: 'all-supported', onWindow: () => {}, onError: fail });
                assertCurrent();
                mapping = { contextStart: started.recordContextStart, startTick: options.startTick, tempo: doc.tempo.bpm, cycle };
                emit({ status: options.countInBars && (audio.now?.() ?? started.recordContextStart) < started.recordContextStart ? 'countIn' : 'recording', countInBeat: options.countInBars ? 1 : 0 });
                armTimer();
            } catch (error) { if (isCurrent()) fail(error); else stopTransport(); throw error; }
        },
        noteOn(key: string, track: MidiSoundTrack, pitch: number, velocity: number, contextTime?: number) {
            const audio = acquireAudio(), at = Number.isFinite(contextTime) ? contextTime : audio?.now?.();
            if (audio) void audio.noteOn(key, track, pitch, velocity).catch(fail);
            if (!capture || !mapping || at === undefined || !isCurrent() || at < mapping.contextStart) return false;
            if (snapshot.status === 'countIn') emit({ status: 'recording', countInBeat: 0 });
            if (snapshot.status !== 'recording') return false;
            const accepted = capture.on(key, pitch, velocity, tickAt(at));
            if (accepted) { capturedKeys.add(key); emit({ noteCount: capture.take.notes.length }); }
            return accepted;
        },
        noteOff(key: string, contextTime?: number) {
            const audio = usedAudio, at = Number.isFinite(contextTime) ? contextTime : audio?.now?.(); audio?.noteOff(key);
            if (!capture || !mapping || at === undefined || !capturedKeys.delete(key) || !isCurrent()) return;
            capture.off(key, tickAt(at));
        },
        async finish() {
            return runMutation(async () => {
                if (capture && !mapping) {
                    stopTransport(); ++intent; capture = null; identity = null; pendingStore = null;
                    emit({ status: 'idle', noteCount: 0, countInBeat: 0, error: '' });
                    return;
                }
                if (!capture || !mapping || !identity) { stopTransport(); return; }
                const activeCapture = capture, at = usedAudio?.now?.() ?? mapping.contextStart;
                activeCapture.update(tickAt(at));
                stopTransport(); emit({ status: 'finishing', countInBeat: 0 });
                if (!activeCapture.take.notes.length) { capture = null; mapping = null; emit({ status: 'idle', noteCount: 0, error: '' }); return; }
                try {
                    await durableExisting(activeCapture.take, activeCapture);
                    capture = null; mapping = null; emit({ status: 'idle', error: '', noteCount: activeCapture.take.notes.length });
                } catch (error) { fail(error); throw error; }
            });
        },
        async retry(snap?: number) {
            return runMutation(async () => {
                if (capture?.take.notes.length && identity && pendingStore && !snapshot.pending) {
                    const activeCapture = capture;
                    const take = snap === undefined ? activeCapture.take : { ...activeCapture.take, snap };
                    emit({ status: 'finishing', error: '' });
                    try {
                        await durableExisting(take, snap === undefined ? activeCapture : undefined);
                        capture = null; mapping = null;
                        emit({ status: 'idle', error: '', noteCount: take.notes.length });
                        return;
                    } catch (error) {
                        fail(error);
                        throw error;
                    }
                }
                if (!identity || !pendingStore) {
                    const owner = deps.owner();
                    if (!owner) throw new MidiRecordingError('account_required');
                    const generation = deps.generation(), operationIntent = ++intent;
                    identity = { owner, generation, intent: operationIntent };
                    pendingStore = storeFor(owner, generation, operationIntent);
                    const pending = await pendingStore.read(); assertCurrent();
                    const compatible = !pending || takeMatchesSource(pending.take, deps.current());
                    emit({ pending, status: pending ? compatible ? 'recovery' : 'conflict' : 'idle', error: compatible ? '' : 'recording_source_mismatch' });
                }
                const envelope = snapshot.pending ?? await pendingStore!.read();
                if (!envelope) throw new MidiRecordingError('recording_not_recoverable');
                if (snap !== undefined) throw new MidiRecordingError('recording_not_recoverable');
                emit({ status: 'finishing', error: '' });
                try { await restoreEnvelope(envelope, snap); }
                catch (error) { emit({ status: conflictStatus(error), error: (error as Error).message }); throw error; }
            });
        },
        async saveAsNewBeat(id = deps.newBeatId?.()) {
            return runMutation(async () => {
                if (!id || !deps.addBeatFromDocument) throw new MidiRecordingError('recording_not_recoverable');
                if (!identity || !pendingStore) throw new MidiRecordingError('recording_not_recoverable');
                const envelope = snapshot.pending ?? await pendingStore.read();
                const recoverableTake = envelope?.take ?? capture?.take;
                if (!recoverableTake) throw new MidiRecordingError('recording_not_recoverable');
                const found = identity; assertCurrent(found);
                emit({ status: 'finishing', error: '' });
                try {
                    for (;;) {
                        const source = deps.current();
                        if (!source) throw new MidiRecordingError('recording_not_recoverable');
                        if (!takeMatchesSource(recoverableTake, source)) throw new MidiRecordingError('recording_source_mismatch');
                        const targetCreatedAt = Date.now();
                        const next = takeAsNewBeat(source, recoverableTake, { id, now: targetCreatedAt });
                        const baseFingerprint = await beatFingerprint(source); assertCurrent(found);
                        const expectedFingerprint = await beatFingerprint(next); assertCurrent(found);
                        const baseContentFingerprint = await beatFingerprint(source, { excludeLiveMix: true }); assertCurrent(found);
                        const expectedContentFingerprint = await beatFingerprint(next, { excludeLiveMix: true }); assertCurrent(found);
                        if (deps.current() !== source) continue;
                        const prepared = await pendingStore!.prepare({ take: recoverableTake, baseFingerprint, expectedFingerprint,
                            baseContentFingerprint, expectedContentFingerprint, target: { kind: 'new', beatId: id }, createdAt: targetCreatedAt });
                        assertCurrent(found);
                        if (deps.current() !== source) continue;
                        emit({ pending: prepared });
                        if (!deps.addBeatFromDocument(next, found.owner)) throw new MidiRecordingError('recording_commit_failed');
                        await deps.flush(id); assertCurrent(found);
                        const saved = await deps.readSaved(id); assertCurrent(found);
                        const savedContent = saved && await beatFingerprint(saved, { excludeLiveMix: true }); assertCurrent(found);
                        if (!saved || savedContent !== expectedContentFingerprint) throw new MidiRecordingError('recording_commit_failed');
                        await pendingStore!.remove(); capture = null; mapping = null; emit({ status: 'idle', pending: null, error: '' });
                        return next;
                    }
                } catch (error) {
                    emit({ status: conflictStatus(error), error: (error as Error).message });
                    throw error;
                }
            });
        },
        async discard() {
            stopTransport(); const running = activeMutation; const oldStore = pendingStore; ++intent;
            capture = null; mapping = null; identity = null; pendingStore = null;
            emit({ status: 'idle', pending: null, error: '', noteCount: 0, countInBeat: 0 });
            const cleanup = oldStore?.revoke();
            await trackCleanup(running, cleanup);
        },
        async revoke() {
            stopTransport(); const running = activeMutation; const oldStore = pendingStore; ++intent;
            capture = null; mapping = null; identity = null; pendingStore = null;
            emit({ status: 'idle', pending: null, error: '', noteCount: 0, countInBeat: 0 });
            const cleanup = oldStore?.revoke();
            await trackCleanup(running, cleanup);
        },
        beforeReplace: async () => {
            if (activeMutation) { await activeMutation; return; }
            if (snapshot.pending && !capture) throw new MidiRecordingError('recording_not_recoverable');
            await controller.finish();
        },
        dispose() { stopTransport(); ++intent; capture = null; mapping = null; identity = null; pendingStore = null; listeners.clear(); },
    };
    return controller;
}
export type MidiRecordingController = ReturnType<typeof createMidiRecording>;
