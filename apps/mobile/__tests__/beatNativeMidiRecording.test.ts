jest.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));
import { createMidiRecording } from '../src/lib/beatNative/midiRecording';
import { midiPendingFile, midiRevokedFile } from '../src/lib/beatNative/midiPending';
import { addInstrumentTrack, asMidiDoc, type MidiSoundTrack } from '../src/lib/beatNative/midi';
import { createBeatStore } from '../src/lib/beatNative/store';
import { createBeat, setTrackGain } from '../src/lib/beatNative/doc';
import { deferred, memoryFiles, OTHER, tick, USER } from './beatNativeFixtures';

function harness() {
    const files = memoryFiles(), store = createBeatStore(files), base = store.newBeat('MIDI capture');
    store.putBeat(addInstrumentTrack(base, { engine: 'voice', id: 'piano', preset: 'grand' }));
    const id = base.id; let generation = 1, now = 0.2, result = { contextStart: 0.1, recordContextStart: 0.1 };
    const audio = { now: () => now, playRange: jest.fn(async () => result), stop: jest.fn(), releaseKeys: jest.fn(),
        noteOn: jest.fn(async () => {}), noteOff: jest.fn() };
    const commit = jest.fn((doc, _count) => store.putBeat(doc));
    const controller = createMidiRecording({ beatId: id, owner: () => USER, generation: () => generation, current: () => store.getBeat(id),
        audio: () => audio as never, commit, flush: id => store.flushBeat(id), readSaved: id => store.readSavedDoc(id), files: () => files,
        getBeat: id => store.getBeat(id), addBeatFromDocument: (doc, owner) => store.addBeatFromDocument(doc, owner), newBeatId: () => '55555555-5555-4555-8555-555555555555',
        setTimer: () => 1, clearTimer: () => {} });
    const track = () => store.getBeat(id)!.tracks.find(item => item.kind === 'midi') as unknown as MidiSoundTrack;
    return { files, store, id, audio, commit, controller, track, setNow: (value: number) => { now = value; },
        setGeneration: (value: number) => { generation = value; }, setResult: (value: typeof result) => { result = value; } };
}

test('audio-clock note capture commits once and a count-in never captures early audition', async () => {
    const h = harness(); h.setResult({ contextStart: 0.1, recordContextStart: 2.1 });
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 1 });
    h.setNow(0.2); expect(h.controller.noteOn('early', h.track(), 60, 100)).toBe(false); h.controller.noteOff('early');
    await h.controller.discard();
    h.setResult({ contextStart: 0.1, recordContextStart: 0.1 });
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.setNow(0.2); expect(h.controller.noteOn('c4', h.track(), 60, 100)).toBe(true);
    h.setNow(0.45); h.controller.noteOff('c4'); await h.controller.finish();
    expect(h.commit).toHaveBeenCalledTimes(1);
    const midi = asMidiDoc(h.store.getBeat(h.id)!); const notes = Object.values(midi.clips).flatMap(clip => clip.notes);
    expect(notes).toEqual([[147, 368, 60, 100]]);
    expect(h.controller.snapshot()).toMatchObject({ status: 'idle', noteCount: 1, pending: null });
});

test('a deferred envelope write recomputes against live mix before one atomic note commit', async () => {
    const h = harness(), gate = deferred<void>(), originalWrite = h.files.write;
    jest.mocked(h.files.write).mockImplementationOnce(async () => gate.promise);
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.controller.noteOn('c4', h.track(), 60, 100); h.setNow(0.4); h.controller.noteOff('c4');
    const finishing = h.controller.finish();
    h.store.putBeat(setTrackGain(h.store.getBeat(h.id)!, h.track().id, 0.25));
    gate.resolve(); await finishing;
    expect(h.store.getBeat(h.id)!.tracks.find(track => track.id === h.track().id)!.gain).toBe(0.25);
    expect(Object.values(asMidiDoc(h.store.getBeat(h.id)!).clips).flatMap(clip => clip.notes)).toHaveLength(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(jest.mocked(originalWrite).mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('normalized keyboard timestamps are authoritative over a later audio-clock read', async () => {
    const h = harness(); await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.setNow(8);
    expect(h.controller.noteOn('timed', h.track(), 64, 90, 0.2)).toBe(true);
    h.controller.noteOff('timed', 0.45); await h.controller.finish();
    const note = Object.values(asMidiDoc(h.store.getBeat(h.id)!).clips).flatMap(clip => clip.notes)[0];
    expect(note).toEqual([147, 368, 64, 90]);
});

test('finalizing a pending start fences its later transport result and releases the lock', async () => {
    const h = harness(), gate = deferred<{ contextStart: number; recordContextStart: number }>();
    h.audio.playRange.mockReturnValueOnce(gate.promise);
    const starting = h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 1 });
    expect(h.controller.locked()).toBe(true);
    await h.controller.finish(); expect(h.controller.locked()).toBe(false);
    gate.resolve({ contextStart: 0.1, recordContextStart: 2.1 });
    await expect(starting).rejects.toMatchObject({ code: 'account_changed' });
    expect(h.controller.snapshot().status).toBe('idle');
});

test('failed flush leaves a prepared take; same-owner new-generation restore finishes the already-applied document idempotently', async () => {
    const h = harness();
    const originalFlush = h.store.flushBeat; let fail = true;
    const broken = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id), audio: () => h.audio as never,
        commit: (doc, count) => h.commit(doc, count), flush: async id => { if (fail) { fail = false; throw new Error('disk_full'); } await originalFlush(id); },
        readSaved: id => h.store.readSavedDoc(id), files: () => h.files, setTimer: () => 1, clearTimer: () => {} });
    await broken.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    broken.noteOn('d4', h.track(), 62, 100); h.setNow(0.5); broken.noteOff('d4');
    await expect(broken.finish()).rejects.toThrow('disk_full');
    expect(h.commit).toHaveBeenCalledTimes(1);
    h.setGeneration(2);
    const relaunched = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 2, current: () => h.store.getBeat(h.id), audio: () => h.audio as never,
        commit: (doc, count) => h.commit(doc, count), flush: originalFlush, readSaved: id => h.store.readSavedDoc(id), files: () => h.files,
        setTimer: () => 1, clearTimer: () => {} });
    expect(await relaunched.refreshRecovery()).not.toBeNull(); await relaunched.retry();
    expect(h.commit).toHaveBeenCalledTimes(1); expect(relaunched.snapshot().pending).toBeNull();
});

test('recovery quarantines a durable take whose source track identity no longer matches', async () => {
    const h = harness(); let fail = true;
    const controller = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        flush: async id => { if (fail) { fail = false; throw new Error('disk_full'); } await h.store.flushBeat(id); },
        readSaved: id => h.store.readSavedDoc(id), addBeatFromDocument: (doc, owner) => h.store.addBeatFromDocument(doc, owner),
        newBeatId: () => '88888888-8888-4888-8888-888888888888', setTimer: () => 1, clearTimer: () => {} });
    await controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    controller.noteOn('c4', h.track(), 60, 100, 0.2); controller.noteOff('c4', 0.4);
    await expect(controller.finish()).rejects.toThrow('disk_full');
    const changed = structuredClone(h.store.getBeat(h.id)!);
    const source = changed.tracks.find(track => track.id === h.track().id)!;
    source.name = 'A different instrument source'; h.store.putBeat(changed);
    h.setGeneration(2);
    const relaunched = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 2, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        flush: id => h.store.flushBeat(id), readSaved: id => h.store.readSavedDoc(id),
        addBeatFromDocument: (doc, owner) => h.store.addBeatFromDocument(doc, owner), newBeatId: () => '88888888-8888-4888-8888-888888888888',
        setTimer: () => 1, clearTimer: () => {} });
    expect(await relaunched.refreshRecovery()).not.toBeNull();
    expect(relaunched.snapshot()).toMatchObject({ status: 'conflict', error: 'recording_source_mismatch' });
    await expect(relaunched.retry()).rejects.toMatchObject({ code: 'recording_source_mismatch' });
    await expect(relaunched.saveAsNewBeat()).rejects.toMatchObject({ code: 'recording_source_mismatch' });
});

test('a failed initial pending write keeps the in-memory take visible and retryable', async () => {
    const h = harness();
    jest.mocked(h.files.write).mockRejectedValueOnce(new Error('disk_full'));
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.controller.noteOn('e4', h.track(), 64, 100); h.setNow(0.5); h.controller.noteOff('e4');
    await expect(h.controller.finish()).rejects.toThrow('disk_full');
    expect(h.controller.snapshot()).toMatchObject({ status: 'recovery', noteCount: 1, pending: null });
    await h.controller.retry();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.controller.snapshot()).toMatchObject({ status: 'idle', noteCount: 1, pending: null });
});

test('generation revocation during a pending prepare cannot mutate the document', async () => {
    const h = harness(), gate = deferred<void>(); jest.mocked(h.files.write).mockImplementationOnce(() => gate.promise);
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.controller.noteOn('c4', h.track(), 60, 100); h.setNow(0.4); h.controller.noteOff('c4');
    const finishing = h.controller.finish(); h.setGeneration(2); gate.resolve();
    await expect(finishing).rejects.toMatchObject({ code: 'account_changed' });
    expect(h.commit).not.toHaveBeenCalled(); await expect(h.controller.revoke()).resolves.toBeUndefined();
});

test('revocation serializes behind an in-flight prepare so old-owner bytes cannot be resurrected', async () => {
    const h = harness(), gate = deferred<void>(), started = deferred<void>(), originalWrite = h.files.write;
    jest.mocked(h.files.write).mockImplementationOnce(async (name, text) => {
        started.resolve(); await gate.promise; await originalWrite(name, text);
    });
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.controller.noteOn('c4', h.track(), 60, 100); h.setNow(0.4); h.controller.noteOff('c4');
    const finishing = h.controller.finish(); await started.promise;
    h.setGeneration(2); const revoking = h.controller.revoke(); gate.resolve();
    await expect(finishing).rejects.toMatchObject({ code: 'pending_take_stale' });
    await expect(revoking).resolves.toBeUndefined();
    expect(h.files.data.has(midiPendingFile(h.id))).toBe(false);
    expect(h.files.data.has(midiRevokedFile(h.id))).toBe(true); expect(h.commit).not.toHaveBeenCalled();
    const relaunched = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 2, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), flush: id => h.store.flushBeat(id),
        readSaved: id => h.store.readSavedDoc(id), files: () => h.files, setTimer: () => 1, clearTimer: () => {} });
    await expect(relaunched.refreshRecovery()).resolves.toBeNull();
});

test('revocation clears the snapshot when the primary tombstone fails but quarantine and removal succeed', async () => {
    const h = harness(); let failFlush = true;
    const controller = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        flush: async id => { if (failFlush) { failFlush = false; throw new Error('disk_full'); } await h.store.flushBeat(id); },
        readSaved: id => h.store.readSavedDoc(id), setTimer: () => 1, clearTimer: () => {} });
    await controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    controller.noteOn('c4', h.track(), 60, 100, 0.2); controller.noteOff('c4', 0.4);
    await expect(controller.finish()).rejects.toThrow('disk_full');
    jest.mocked(h.files.write).mockImplementation(async (name, value) => {
        if (name === midiPendingFile(h.id)) throw new Error('tombstone_failed');
        h.files.data.set(name, value);
    });
    await expect(controller.revoke()).resolves.toBeUndefined();
    expect(controller.snapshot()).toEqual({ status: 'idle', noteCount: 0, countInBeat: 0, error: '', pending: null });
    expect(controller.locked()).toBe(false);
});

test('durable quarantine prevents relaunch recovery when primary tombstone and removal both fail', async () => {
    const h = harness(); let failFlush = true;
    const controller = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        flush: async id => { if (failFlush) { failFlush = false; throw new Error('disk_full'); } await h.store.flushBeat(id); },
        readSaved: id => h.store.readSavedDoc(id), setTimer: () => 1, clearTimer: () => {} });
    await controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    controller.noteOn('c4', h.track(), 60, 100, 0.2); controller.noteOff('c4', 0.4);
    await expect(controller.finish()).rejects.toThrow('disk_full');
    jest.mocked(h.files.write).mockImplementation(async (name, value) => {
        if (name === midiPendingFile(h.id)) throw new Error('tombstone_failed');
        h.files.data.set(name, value);
    });
    jest.mocked(h.files.remove).mockImplementation(async name => {
        if (name === midiPendingFile(h.id)) throw new Error('remove_failed');
        h.files.data.delete(name);
    });
    await expect(controller.revoke()).resolves.toBeUndefined();
    expect(controller.snapshot()).toEqual({ status: 'idle', noteCount: 0, countInBeat: 0, error: '', pending: null });
    expect(controller.locked()).toBe(false);
    expect(h.files.data.has(midiPendingFile(h.id))).toBe(true);
    expect(h.files.data.has(midiRevokedFile(h.id))).toBe(true);
    const relaunched = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 2, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        flush: id => h.store.flushBeat(id), readSaved: id => h.store.readSavedDoc(id), setTimer: () => 1, clearTimer: () => {} });
    await expect(relaunched.refreshRecovery()).resolves.toBeNull();
});

test('replacement joins an in-flight finish and cannot pass it or duplicate the commit', async () => {
    const h = harness(), gate = deferred<void>(), started = deferred<void>(), originalWrite = h.files.write;
    jest.mocked(h.files.write).mockImplementationOnce(async (name, value) => {
        started.resolve(); await gate.promise; await originalWrite(name, value);
    });
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    h.controller.noteOn('c4', h.track(), 60, 100, 0.2); h.controller.noteOff('c4', 0.4);
    const finishing = h.controller.finish(); await started.promise;
    let replacementSettled = false;
    const replacement = h.controller.beforeReplace().then(() => { replacementSettled = true; });
    await tick(); expect(replacementSettled).toBe(false); expect(h.commit).not.toHaveBeenCalled();
    gate.resolve(); await finishing; await replacement;
    expect(replacementSettled).toBe(true); expect(h.commit).toHaveBeenCalledTimes(1);
});

test('discard stays locked through deferred quarantine cleanup before a new capture may start', async () => {
    const h = harness(), gate = deferred<void>(), started = deferred<void>(), originalWrite = h.files.write;
    await h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    jest.mocked(h.files.write).mockImplementationOnce(async (name, value) => {
        started.resolve(); await gate.promise; await originalWrite(name, value);
    });
    const discarding = h.controller.discard(); await started.promise;
    expect(h.controller.locked()).toBe(true);
    await expect(h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 })).rejects.toMatchObject({ code: 'recording_busy' });
    gate.resolve(); await discarding;
    expect(h.controller.locked()).toBe(false);
    await expect(h.controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 })).resolves.toBeUndefined();
    await h.controller.discard();
});

test('save-as-new recovery is idempotent when insertion landed but its first flush failed', async () => {
    const h = harness(), target = '55555555-5555-4555-8555-555555555555'; let sourceFailure = true, targetFailure = true;
    const controller = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        getBeat: id => h.store.getBeat(id), readSaved: id => h.store.readSavedDoc(id),
        addBeatFromDocument: (doc, owner) => h.store.addBeatFromDocument(doc, owner),
        flush: async id => {
            if (id === h.id && sourceFailure) { sourceFailure = false; throw new Error('source_disk_full'); }
            if (id === target && targetFailure) { targetFailure = false; throw new Error('target_disk_full'); }
            await h.store.flushBeat(id);
        }, setTimer: () => 1, clearTimer: () => {} });
    await controller.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    controller.noteOn('c4', h.track(), 60, 100, 0.2); controller.noteOff('c4', 0.4);
    await expect(controller.finish()).rejects.toThrow('source_disk_full');
    await expect(controller.saveAsNewBeat(target)).rejects.toThrow('target_disk_full');
    expect(controller.snapshot().status).toBe('recovery');
    expect(h.store.getBeat(target)).toBeDefined();
    const relaunched = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 2, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        getBeat: id => h.store.getBeat(id), readSaved: id => h.store.readSavedDoc(id), addBeatFromDocument: (doc, owner) => h.store.addBeatFromDocument(doc, owner),
        flush: id => h.store.flushBeat(id), setTimer: () => 1, clearTimer: () => {} });
    expect((await relaunched.refreshRecovery())?.target).toEqual({ kind: 'new', beatId: target });
    await expect(relaunched.retry(240)).rejects.toMatchObject({ code: 'recording_not_recoverable' });
    await relaunched.retry();
    expect((await h.store.readSavedDoc(target))?.id).toBe(target);
    expect(relaunched.snapshot().pending).toBeNull();
});

test('save-as-new can recover after preparation landed but insertion never started', async () => {
    const h = harness(), target = '77777777-7777-4777-8777-777777777777'; let sourceFailure = true;
    const crashed = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        getBeat: id => h.store.getBeat(id), readSaved: id => h.store.readSavedDoc(id),
        addBeatFromDocument: () => { throw new Error('simulated_crash_before_insert'); },
        flush: async id => { if (id === h.id && sourceFailure) { sourceFailure = false; throw new Error('source_disk_full'); } await h.store.flushBeat(id); },
        setTimer: () => 1, clearTimer: () => {} });
    await crashed.start({ trackId: h.track().id, startTick: 0, snap: 0, countInBars: 0 });
    crashed.noteOn('c4', h.track(), 60, 100, 0.2); crashed.noteOff('c4', 0.4);
    await expect(crashed.finish()).rejects.toThrow('source_disk_full');
    await expect(crashed.saveAsNewBeat(target)).rejects.toThrow('simulated_crash_before_insert');
    expect(crashed.snapshot()).toMatchObject({ status: 'recovery', pending: { target: { kind: 'new', beatId: target } } });
    h.setGeneration(2); await tick();
    const relaunched = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 2, current: () => h.store.getBeat(h.id),
        audio: () => h.audio as never, commit: (doc, count) => h.commit(doc, count), files: () => h.files,
        getBeat: id => h.store.getBeat(id), readSaved: id => h.store.readSavedDoc(id),
        addBeatFromDocument: (doc, owner) => h.store.addBeatFromDocument(doc, owner), flush: id => h.store.flushBeat(id),
        setTimer: () => 1, clearTimer: () => {} });
    expect((await relaunched.refreshRecovery())?.target).toEqual({ kind: 'new', beatId: target });
    await relaunched.retry();
    expect((await h.store.readSavedDoc(target))?.id).toBe(target);
    expect(relaunched.snapshot().pending).toBeNull();
});

test('validated document insertion stamps the current owner and refuses duplicates or a stale owner', () => {
    const perOwner = new Map<string, ReturnType<typeof memoryFiles>>();
    const store = createBeatStore({ forOwner: owner => {
        let files = perOwner.get(owner); if (!files) { files = memoryFiles(); perOwner.set(owner, files); } return files;
    }, erase: () => {} });
    store.setOwner(USER);
    const doc = createBeat({ id: '66666666-6666-4666-8666-666666666666', title: 'Recovered take', now: 10 });
    expect(store.addBeatFromDocument(doc, OTHER)).toBe(false);
    expect(store.addBeatFromDocument(doc, USER)).toBe(true);
    expect(store.getRecord(doc.id)?.owner).toBe(USER);
    expect(store.addBeatFromDocument(doc, USER)).toBe(false);
});

test('idle finish and dispose never lazily acquire an audio engine', async () => {
    const h = harness(), acquire = jest.fn(() => h.audio as never);
    const controller = createMidiRecording({ beatId: h.id, owner: () => USER, generation: () => 1, current: () => h.store.getBeat(h.id),
        audio: acquire, commit: () => false, flush: id => h.store.flushBeat(id), readSaved: id => h.store.readSavedDoc(id), files: () => h.files });
    await controller.finish(); controller.dispose();
    expect(acquire).not.toHaveBeenCalled();
});
