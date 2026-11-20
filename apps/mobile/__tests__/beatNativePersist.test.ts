import { createBeatStore } from '../src/lib/beatNative/store';
import { setTempo } from '../src/lib/beatNative/doc';
import { createHistory, record, travel } from '../src/lib/beatNative/history';
import { versionEdit } from '../src/lib/beatNative/versions';
import { needsSync } from '../src/lib/beatNative/rules';
import { memoryFiles, deferred, tick, USER, PROJECT } from './beatNativeFixtures';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('save and relaunch preserve the web record; invalid docs refused; drop removes the file', async () => {
    const files = memoryFiles(), store = createBeatStore(files);
    const doc = store.newBeat('Keep me');
    store.putBeat(setTempo(doc, 110)); await store.flushBeats();
    expect(store.putBeat({ ...doc, tempo: { bpm: -1 } })).toBe(false);
    const relaunched = createBeatStore(files); await relaunched.hydrateBeats();
    expect(relaunched.getRecord(doc.id)).toEqual(store.getRecord(doc.id));
    expect(relaunched.getBeat(doc.id)).toEqual(store.getBeat(doc.id));
    relaunched.dropBeat(doc.id); await relaunched.flushBeats();
    expect(files.data.has(`${doc.id}.json`)).toBe(false);
});

test('corrupt JSON and invalid records are quarantined without deleting earlier .bad files', async () => {
    const files = memoryFiles();
    files.data.set('broken.json', '{broken'); files.data.set('broken.json.bad', 'original');
    files.data.set('invalid.json', JSON.stringify({ doc: {} }));
    const store = createBeatStore(files); await store.hydrateBeats();
    expect(store.listBeats()).toEqual([]);
    expect(files.data.get('broken.json.bad')).toBe('original');
    expect(files.data.get('broken.json.1.bad')).toBe('{broken');
    expect(files.data.get('invalid.json.bad')).toBe(JSON.stringify({ doc: {} }));
    expect(files.data.has('broken.json')).toBe(false);
});

test('N rapid edits debounce to one complete write; flush cancels the timer', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Debounce');
    for (let bpm = 100; bpm < 110; bpm++) store.putBeat(setTempo(store.getBeat(doc.id)!, bpm));
    await jest.advanceTimersByTimeAsync(799); expect(files.write).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1); expect(files.write).toHaveBeenCalledTimes(1);
    store.putBeat(setTempo(store.getBeat(doc.id)!, 120)); await store.flushBeats();
    expect(files.write).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(800); expect(files.write).toHaveBeenCalledTimes(2);
});

test('hydration is shared and cannot overwrite an edit or resurrect a dropped beat', async () => {
    const files = memoryFiles(), first = createBeatStore(files), doc = first.newBeat('Old'); await first.flushBeats();
    const read = files.read, gate = deferred<string | null>();
    files.read = jest.fn(() => gate.promise);
    const store = createBeatStore(files), a = store.hydrateBeats(), b = store.hydrateBeats();
    expect(a).toBe(b); await tick(); store.dropBeat(doc.id);
    gate.resolve(await read(`${doc.id}.json`)); await a;
    expect(store.getBeat(doc.id)).toBeUndefined();
});

test('replacement waits for in-flight persistence, captures the latest edit, and excludes mutations during stash', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Local');
    const started = deferred(), gate = deferred(), original = files.write;
    files.write = jest.fn(async (name: string, text: string) => { started.resolve(); await gate.promise; await original(name, text); });
    const write = store.flushBeat(doc.id); await started.promise;
    store.putBeat(setTempo(store.getBeat(doc.id)!, 123));
    const stashStarted = deferred(), stashGate = deferred(); let stashed;
    const theirs = { ...doc, title: 'Theirs' };
    const replacing = store.replaceFromCloud(doc.id, { doc: theirs, cloud: { userId: USER, projectId: PROJECT, revision: 3, syncedUpdatedAt: theirs.updatedAt } }, {
        isCurrent: () => true,
        stash: async captured => { stashed = captured; stashStarted.resolve(); await stashGate.promise; },
    });
    expect(store.saveState(doc.id)).toBe('busy');
    expect(store.putBeat(setTempo(doc, 130))).toBe(false);
    gate.resolve(); await write; await stashStarted.promise;
    expect(stashed).toEqual(expect.objectContaining({ tempo: { bpm: 123 } }));
    stashGate.resolve(); await replacing; await jest.advanceTimersByTimeAsync(800);
    const relaunched = createBeatStore(files); await relaunched.hydrateBeats();
    expect(relaunched.getBeat(doc.id)).toEqual(theirs);
    expect(relaunched.getRecord(doc.id)?.cloud?.revision).toBe(3);
    expect(store.saveState(doc.id)).toBe('saved');
});

test.each(['stash', 'account', 'disk'])('failed %s releases the barrier and leaves the local document intact', async failure => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Local'); await store.flushBeats();
    const original = files.write; let current = true;
    if (failure === 'disk') files.write = jest.fn(async () => { throw new Error('disk'); });
    await expect(store.replaceFromCloud(doc.id, { doc: { ...doc, title: 'Theirs' }, cloud: { userId: USER, projectId: PROJECT, revision: 2, syncedUpdatedAt: doc.updatedAt } }, {
        isCurrent: () => current, stash: async () => { if (failure === 'stash') throw new Error('stash'); if (failure === 'account') current = false; },
    })).rejects.toThrow();
    files.write = original;
    expect(store.getBeat(doc.id)).toEqual(doc);
    expect(store.saveState(doc.id)).not.toBe('busy');
    expect(store.putBeat(setTempo(doc, 150))).toBe(true);
});

test('restoring a validated version is exactly one history entry and undo is persisted', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Before');
    const before = store.getBeat(doc.id)!;
    const restored = versionEdit(JSON.stringify({ ...doc, title: 'Earlier', tempo: { bpm: 130 } }), doc.id)(before);
    store.putBeat(restored);
    const history = record(createHistory(before), store.getBeat(doc.id)!, { label: 'Restore version' });
    expect(history.past).toHaveLength(1); expect(history.past[0].label).toBe('Restore version');
    store.putBeat(travel(history, 'undo').present); await store.flushBeats();
    const relaunched = createBeatStore(files); await relaunched.hydrateBeats();
    expect(relaunched.getBeat(doc.id)).toMatchObject({ title: before.title, tempo: before.tempo });
    expect(() => versionEdit('{}', doc.id)).toThrow();
    expect(() => versionEdit(JSON.stringify({ ...doc, id: PROJECT }), doc.id)).toThrow();
});

test.each(['undo', 'redo'] as const)('%s remains dirty after relaunch with equal time and clock rollback', async direction => {
    for (const now of [2000, 1]) {
        jest.setSystemTime(2000);
        const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Before');
        store.putBeat(setTempo(doc, 130));
        let history = record(createHistory(doc), store.getBeat(doc.id)!);
        if (direction === 'redo') { history = travel(history, 'undo'); store.putBeat(history.present); }
        const synced = store.getBeat(doc.id)!;
        store.setCloudLink(doc.id, { userId: USER, projectId: PROJECT, revision: 2, syncedUpdatedAt: synced.updatedAt });
        jest.setSystemTime(now);
        const next = travel(history, direction); store.putBeat(next.present); await store.flushBeats();
        const relaunched = createBeatStore(files); await relaunched.hydrateBeats();
        const saved = relaunched.getRecord(doc.id)!;
        expect(saved.doc.updatedAt).toBeGreaterThan(synced.updatedAt);
        expect(needsSync(saved, USER)).toBe(true);
    }
});

test.each(['read', 'quarantine-write', 'quarantine-remove'])('a failed %s skips only that file, preserving other saved beats', async fail => {
    const files = memoryFiles(), original = createBeatStore(files), doc = original.newBeat('Readable');
    await original.flushBeats(); files.data.set('unreadable.json', '{corrupt');
    const read = files.read, write = files.write, remove = files.remove;
    files.read = jest.fn(async (name: string) => { if (fail === 'read' && name === 'unreadable.json') throw new Error('read_failed'); return read(name); });
    files.write = jest.fn(async (name: string, text: string) => { if (fail === 'quarantine-write' && name.endsWith('.bad')) throw new Error('write_failed'); return write(name, text); });
    files.remove = jest.fn(async (name: string) => { if (fail === 'quarantine-remove' && name === 'unreadable.json') throw new Error('remove_failed'); return remove(name); });
    const relaunched = createBeatStore(files);
    await expect(relaunched.hydrateBeats()).resolves.toBeUndefined();
    expect(relaunched.getBeat(doc.id)).toEqual(doc);
    expect(files.data.get('unreadable.json')).toBe('{corrupt');
    expect(relaunched.hydrationState()).toBe('ready');
});

test('list failure still fails hydration and can be retried', async () => {
    const files = memoryFiles(), list = files.list;
    files.list = jest.fn(async () => { throw new Error('list_failed'); });
    const store = createBeatStore(files);
    await expect(store.hydrateBeats()).rejects.toThrow('list_failed');
    expect(store.hydrationState()).toBe('error');
    files.list = list; await store.hydrateBeats(); expect(store.hydrationState()).toBe('ready');
});

test('post-save listener failures cannot undo a durable flush or replacement', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Original');
        const states: string[] = [];
        store.onPersisted((_id, saved) => { states.push(store.saveState(doc.id)); expect(store.getBeat(doc.id)).toEqual(saved); throw new Error('take_store_unreadable'); });
        await expect(store.flushBeat(doc.id)).resolves.toBeUndefined();
        expect(store.saveState(doc.id)).toBe('saved'); expect(store.getPersistedBeat(doc.id)).toEqual(doc);
        const replacement = { ...doc, title: 'Cloud revision', updatedAt: doc.updatedAt + 1 };
        await expect(store.replaceFromCloud(doc.id, { doc: replacement, cloud: { userId: USER, projectId: PROJECT, revision: 2, syncedUpdatedAt: replacement.updatedAt } }, { isCurrent: () => true, stash: async () => {} })).resolves.toBeUndefined();
        expect(store.getBeat(doc.id)).toEqual(replacement); expect(store.saveState(doc.id)).toBe('saved');
        const writes = jest.mocked(files.write).mock.calls.length; await store.flushBeat(doc.id); expect(files.write).toHaveBeenCalledTimes(writes);
        const reopened = createBeatStore(files); await reopened.hydrateBeats(); expect(reopened.getBeat(doc.id)).toEqual(replacement);
        expect(states).toEqual(['saved', 'saved']); expect(warning).toHaveBeenCalledTimes(2);
    } finally { warning.mockRestore(); }
});

test('failed reconciliation retries every durable document without rewriting the beat', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('First saved take');
        const reconciled: string[] = []; let unavailable = true;
        store.onPersisted((_id, saved) => {
            if (unavailable) throw new Error('take_store_unreadable');
            reconciled.push(saved.title);
        });
        await store.flushBeat(doc.id);
        const replacement = { ...doc, title: 'Cloud revision', updatedAt: doc.updatedAt + 1 };
        await store.replaceFromCloud(doc.id, { doc: replacement, cloud: { userId: USER, projectId: PROJECT, revision: 2, syncedUpdatedAt: replacement.updatedAt } }, { isCurrent: () => true, stash: async () => {} });
        const writes = jest.mocked(files.write).mock.calls.length;
        unavailable = false;
        await jest.advanceTimersByTimeAsync(5000);
        expect(reconciled).toEqual(['First saved take', 'Cloud revision']);
        expect(files.write).toHaveBeenCalledTimes(writes);
        expect(store.getBeat(doc.id)).toEqual(replacement);
        expect(store.saveState(doc.id)).toBe('saved');
        await jest.advanceTimersByTimeAsync(5000);
        expect(reconciled).toHaveLength(2);
    } finally { warning.mockRestore(); }
});

test.each(['reset', 'unsubscribe'])('%s cancels deferred post-save reconciliation', async action => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const store = createBeatStore(memoryFiles()), doc = store.newBeat('Local');
        const listener = jest.fn(() => { throw new Error('offline'); });
        const unsubscribe = store.onPersisted(listener);
        await store.flushBeat(doc.id);
        if (action === 'reset') store.resetBeats(); else unsubscribe();
        await jest.advanceTimersByTimeAsync(10000);
        expect(listener).toHaveBeenCalledTimes(1);
    } finally { warning.mockRestore(); }
});
