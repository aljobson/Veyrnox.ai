import { ApiError, type ApiClient } from '../src/lib/api';
import { createTakeCloud } from '../src/lib/beatNative/takeCloud';
import { BeatCloudSync } from '../src/lib/beatNative/cloudSync';
import { createBeatStore } from '../src/lib/beatNative/store';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { addAudioTrack, commitRecording, configureBeatTakeStorage, putBeatTake, loadBeatTake, takeAsset, type CloudTake } from '../src/lib/beatNative/takeShared';
import { encodeWav } from '../src/lib/instrumentShared';
import { fixedDoc, memoryFiles, project, USER } from './beatNativeFixtures';
import { takeIO, takeRow } from './beatNativeTakeFixtures';
import { registerRecordingFinalizer } from '../src/lib/beatNative/recordingFinalizers';
const token = { userId: USER, current: () => true };
const docWithTake = () => { const doc = addAudioTrack({ ...fixedDoc(), tempo: { bpm: 120 } }); return commitRecording(doc, { trackId: doc.tracks.at(-1)!.id, start: 0, length: 1920, takes: [{ asset: takeAsset(takeRow()) }] }); };
beforeEach(() => { jest.useFakeTimers(); configureBeatTakeStorage(createTakeFiles(takeIO())); });
afterEach(() => jest.useRealTimers());
test('reserve → signed PUT → confirm, ready short-circuit, and pending missing upload re-reserves', async () => {
    await putBeatTake(takeRow()); const events: string[] = []; let rows: CloudTake[] = [];
    const api = { request: jest.fn(async (path: string, init: RequestInit) => {
        if (!init.method) return { takes: rows };
        if (path.endsWith('/takes')) { events.push('reserve'); return { take_id: 'server-take', status: 'pending', upload_url: 'https://signed.test/upload', upload_headers: { 'Content-Type': 'audio/wav' } }; }
        events.push('confirm'); return { status: 'ready' };
    }) };
    const put = jest.fn(async (_url, init) => { events.push('put'); expect(init.body.byteLength).toBe(2044); return { ok: true, status: 200 }; });
    const cloud = createTakeCloud(api as unknown as ApiClient, put as never, () => {});
    await cloud.upload(docWithTake(), token); expect(events).toEqual(['reserve', 'put', 'confirm']);
    rows = [{ id: 'server-take', take_ref: 'take-1', status: 'ready' }]; events.length = 0; await cloud.upload(docWithTake(), token); expect(events).toEqual([]);
    rows[0].status = 'pending'; let missing = true; const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (path, init) => { if (missing && path.endsWith('/server-take') && init.method === 'POST') { missing = false; events.push('confirm-missing'); throw new ApiError(409, 'unknown', { error: { code: 'take_upload_missing' } }); } return original(path, init); });
    await cloud.upload(docWithTake(), token); expect(events).toEqual(['confirm-missing', 'reserve', 'put', 'confirm']);
});
test('over-limit takes remain local and strict preservation fails, downloaded WAV becomes committed', async () => {
    const row = { ...takeRow(), sampleRate: 1 }; await putBeatTake(row);
    const api = { request: jest.fn(async () => ({ takes: [] })) }; const cloud = createTakeCloud(api as unknown as ApiClient, jest.fn() as never, () => {});
    expect(await cloud.upload(docWithTake(), token)).toBe(false); await expect(cloud.upload(docWithTake(), token, true)).rejects.toMatchObject({ code: 'TAKE_LOCAL_ONLY' });
    configureBeatTakeStorage(createTakeFiles(takeIO()));
    const read = { request: jest.fn(async (path: string) => path.endsWith('/takes') ? { takes: [{ id: 'server-take', take_ref: 'take-1', status: 'ready' }] } : { url: 'https://signed.test/download' }) };
    const down = createTakeCloud(read as unknown as ApiClient, jest.fn(async () => ({ ok: true, arrayBuffer: async () => encodeWav(takeRow().samples, 1000) })) as never, () => {});
    await down.download(docWithTake(), token); expect((await loadBeatTake('take-1'))?.state).toBe('committed'); expect((await loadBeatTake('take-1'))?.samples.length).toBe(1000);
});
test('first link saves document first; failed media retries without another document write', async () => {
    await putBeatTake(takeRow()); const store = createBeatStore(memoryFiles()), doc = store.newBeat('Upload'); store.putBeat({ ...docWithTake(), id: doc.id });
    const order: string[] = []; let failUpload = true, ready = false;
    const api = { request: jest.fn(async (path: string, init: RequestInit) => {
        if (init.method === 'PUT') { order.push('document'); return { project: project(doc.id, 1) }; }
        if (path.endsWith('/takes') && init.method === 'POST') { order.push('reserve'); return { take_id: 'server-take', status: 'pending', upload_url: 'https://signed.test/upload', upload_headers: {} }; }
        if (init.method === 'POST') { ready = true; order.push('confirm'); return { status: 'ready' }; }
        if (path.endsWith('/takes')) return { takes: ready ? [{ id: 'server-take', take_ref: 'take-1', status: 'ready' }] : [] };
        return { projects: [] };
    }) };
    global.fetch = jest.fn(async () => { order.push('put'); if (failUpload) throw new Error('network'); return { ok: true, status: 200 }; }) as never;
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id); await sync.start(USER); await sync.link();
    expect(order.slice(0, 3)).toEqual(['document', 'reserve', 'put']); expect(store.getRecord(doc.id)?.cloud?.revision).toBe(1);
    failUpload = false; await sync.retry(); expect(order.filter(x => x === 'document')).toHaveLength(1); expect(sync.snapshot().state).toBe('synced'); sync.dispose();
});
test.each([false, true])('Load theirs preserves outgoing finalized media before stash; upload failure=%s aborts', async failUpload => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Local'); store.putBeat({ ...docWithTake(), id: doc.id }); await putBeatTake({ ...takeRow(), beatId: doc.id });
    store.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: 0 });
    const order: string[] = []; const incoming = { ...doc, title: 'Theirs' };
    const api = { request: jest.fn(async (path: string, init: RequestInit) => {
        if (init.method === 'PUT') { const body = JSON.parse(String(init.body)); if (body.mode !== 'stash') throw new ApiError(409, 'VERSION_CONFLICT'); order.push('stash'); return { project: project(doc.id, 2) }; }
        if (path.endsWith('/takes') && init.method === 'POST') { order.push('reserve'); return { take_id: 'server-take', status: 'pending', upload_url: 'https://signed.test/upload', upload_headers: {} }; }
        if (init.method === 'POST') { order.push('confirm'); return { status: 'ready' }; }
        if (path.endsWith('/takes')) return { takes: [] };
        if (path.endsWith(doc.id)) return { project: project(doc.id, 2), doc_json: JSON.stringify(incoming) };
        return { projects: [] };
    }) };
    global.fetch = jest.fn(async () => { order.push('put'); if (failUpload) throw new Error('network'); return { ok: true, status: 200 }; }) as never;
    const unregister = registerRecordingFinalizer(doc.id, async () => { order.push('finalize'); });
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id); await sync.start(USER); expect(sync.snapshot().state).toBe('conflict');
    await sync.resolve('theirs');
    expect(order).toEqual(failUpload ? ['finalize', 'reserve', 'put'] : ['finalize', 'reserve', 'put', 'confirm', 'stash']);
    expect(store.getBeat(doc.id)?.title).toBe(failUpload ? 'Test beat' : 'Theirs'); expect(store.saveState(doc.id)).not.toBe('busy'); unregister(); sync.dispose();
});

test('a take GET 404 keeps the project linked and permits subsequent document saves', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Cloud-only');
    store.putBeat({ ...docWithTake(), id: doc.id }); const saved = store.getBeat(doc.id)!;
    store.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: saved.updatedAt });
    const api = { request: jest.fn(async (path: string, init: RequestInit) => {
        if (init.method === 'PUT') return { project: project(doc.id, 2) };
        if (path.endsWith('/server-take')) throw new ApiError(404, 'unknown', { error: { code: 'NOT_FOUND' } });
        if (path.endsWith('/takes')) return { takes: [{ id: 'server-take', take_ref: 'take-1', status: 'ready' }] };
        if (path.endsWith(doc.id)) return { project: project(doc.id, 1), doc_json: JSON.stringify(saved) };
        return { projects: [] };
    }) };
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id); await sync.start(USER);
    expect(sync.snapshot().state).toBe('takes'); expect(store.getRecord(doc.id)?.cloud?.projectId).toBe(project(doc.id).id);
    store.putBeat({ ...store.getBeat(doc.id)!, title: 'Still editing' }); await sync.cycle();
    expect(api.request.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
    expect(api.request.mock.calls.filter(([path]) => path.endsWith('/server-take'))).toHaveLength(1);
    expect(sync.snapshot().state).toBe('takes'); expect(store.getRecord(doc.id)?.cloud?.revision).toBe(2); sync.dispose();
});

test.each(['LIMIT_REACHED', 'TAKE_UNAVAILABLE'])('take %s never halts document sync or disables cloud availability', async code => {
    await putBeatTake(takeRow()); const store = createBeatStore(memoryFiles()), doc = store.newBeat('Limits'); store.putBeat({ ...docWithTake(), id: doc.id });
    let revision = 0;
    const api = { request: jest.fn(async (path: string, init: RequestInit) => {
        if (init.method === 'PUT') return { project: project(doc.id, ++revision) };
        if (init.method === 'POST') throw new ApiError(code === 'LIMIT_REACHED' ? 400 : 500, 'unknown', { error: { code } });
        if (path.endsWith('/takes')) return { takes: [] };
        return { projects: [] };
    }) };
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id); await sync.start(USER); await sync.link();
    expect(sync.snapshot().state).toBe('takes'); expect(revision).toBe(1);
    store.putBeat({ ...store.getBeat(doc.id)!, title: 'A new document edit' }); await sync.cycle();
    expect(revision).toBe(2); expect(sync.snapshot().state).toBe('takes');
    expect(api.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1); sync.dispose();
});

test.each(['expired', 'invalid'])('a permanently %s download is refused without endless media retries', async kind => {
    const api = { request: jest.fn(async (path: string) => path.endsWith('/takes') ? { takes: [{ id: 'server-take', take_ref: 'take-1', status: 'ready' }] } : { url: 'https://signed.test/download' }) };
    const fetcher = jest.fn(async () => ({ ok: kind !== 'expired', status: 403, arrayBuffer: async () => new ArrayBuffer(3) }));
    const cloud = createTakeCloud(api as unknown as ApiClient, fetcher as never, () => {});
    expect(await cloud.download(docWithTake(), token)).toBe(false); expect(await cloud.download(docWithTake(), token)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(cloud.nextRetryAt(docWithTake().id)).toBe(0);
});

test('transient media uses its own 60-second backoff', async () => {
    await putBeatTake(takeRow()); const doc = docWithTake(); let failed = true;
    const api = { request: jest.fn(async (_path: string, init: RequestInit) => {
        if (!init.method) return { takes: [] };
        if (failed) throw new ApiError(503, 'DATA_UNAVAILABLE');
        return { take_id: 'server-take', status: 'ready' };
    }) };
    const cloud = createTakeCloud(api as unknown as ApiClient, jest.fn() as never, () => {}), now = Date.now();
    expect(await cloud.upload(doc, token)).toBe(false); expect(cloud.nextRetryAt(doc.id)).toBe(now + 60000);
    expect(await cloud.upload(doc, token)).toBe(false); expect(api.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    jest.setSystemTime(now + 60000); failed = false;
    expect(await cloud.upload(doc, token)).toBe(true); expect(cloud.nextRetryAt(doc.id)).toBe(0);
});

test('background replacement accepts local-only takes while explicit Load theirs still requires upload', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Local only'); store.putBeat({ ...docWithTake(), id: doc.id });
    await putBeatTake({ ...takeRow(), sampleRate: 1, beatId: doc.id });
    const saved = store.getBeat(doc.id)!; store.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: saved.updatedAt });
    const incoming = { ...doc, title: 'New cloud revision' };
    const api = { request: jest.fn(async (path: string) => {
        if (path.endsWith('/takes')) return { takes: [] };
        if (path.endsWith(doc.id)) return { project: project(doc.id, 2), doc_json: JSON.stringify(incoming) };
        return { projects: [] };
    }) };
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id); await sync.start(USER);
    expect(store.getBeat(doc.id)?.title).toBe('New cloud revision'); expect(sync.snapshot().state).toBe('synced');
    expect((await loadBeatTake('take-1'))?.samples.length).toBe(1000);
    await expect(sync.takes.upload(saved, sync.capture(), true)).rejects.toMatchObject({ code: 'TAKE_LOCAL_ONLY' }); sync.dispose();
});

test.each(['fetch', 'body'])('a download %s network failure backs off for 60 s while document autosave continues', async failure => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Cloud-only');
    store.putBeat({ ...docWithTake(), id: doc.id }); const saved = store.getBeat(doc.id)!;
    store.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: saved.updatedAt });
    const api = { request: jest.fn(async (path: string, init: RequestInit) => {
        if (init.method === 'PUT') return { project: project(doc.id, 2) };
        if (path.endsWith('/server-take')) return { url: 'https://signed.test/download' };
        if (path.endsWith('/takes')) return { takes: [{ id: 'server-take', take_ref: 'take-1', status: 'ready' }] };
        if (path.endsWith(doc.id)) return { project: project(doc.id, 1), doc_json: JSON.stringify(saved) };
        return { projects: [] };
    }) };
    let offline = true;
    const download = jest.spyOn(global, 'fetch').mockImplementation(async () => {
        if (offline && failure === 'fetch') throw new TypeError('Network request failed');
        return { ok: true, arrayBuffer: async () => {
            if (offline) throw new TypeError('Connection lost');
            return encodeWav(takeRow().samples, 1000);
        } } as Response;
    });
    download.mockClear();
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id);
    try {
        await sync.start(USER); expect(sync.snapshot().state).toBe('takes');
        store.putBeat({ ...store.getBeat(doc.id)!, title: 'Document still saves' });
        await jest.advanceTimersByTimeAsync(1600);
        expect(api.request.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
        expect(store.getRecord(doc.id)?.cloud?.revision).toBe(2);
        offline = false; await jest.advanceTimersByTimeAsync(58399);
        expect(download).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(download).toHaveBeenCalledTimes(2); expect(sync.snapshot().state).toBe('synced');
        expect((await loadBeatTake('take-1'))?.state).toBe('committed');
    } finally { sync.dispose(); download.mockRestore(); }
});

test('a deferred download clears when the take becomes available on the device', async () => {
    const api = { request: jest.fn(async () => ({ takes: [] })) };
    const cloud = createTakeCloud(api as unknown as ApiClient, jest.fn() as never, () => {}), doc = docWithTake();
    expect(await cloud.download(doc, token)).toBe(false);
    await putBeatTake(takeRow());
    expect(await cloud.download(doc, token)).toBe(true);
});

test.each(['absent', 'pending'])('an initially %s take downloads automatically when ready 60 seconds later', async initial => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Incoming take');
    store.putBeat({ ...docWithTake(), id: doc.id });
    const saved = store.getBeat(doc.id)!;
    store.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: saved.updatedAt });
    let ready = false;
    const api = { request: jest.fn(async (path: string) => {
        if (path.endsWith('/takes')) return { takes: ready || initial === 'pending' ? [{ id: 'server-take', take_ref: 'take-1', status: ready ? 'ready' : 'pending' }] : [] };
        if (path.endsWith('/server-take')) return { url: 'https://signed.test/download' };
        if (path.endsWith(doc.id)) return { project: project(doc.id, 1), doc_json: JSON.stringify(saved) };
        return { projects: [] };
    }) };
    const download = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, arrayBuffer: async () => encodeWav(takeRow().samples, 1000) } as Response);
    download.mockClear();
    const sync = new BeatCloudSync(api as unknown as ApiClient, store, doc.id);
    try {
        const now = Date.now(); await sync.start(USER);
        expect(sync.snapshot().state).toBe('takes'); expect(sync.takes.nextRetryAt(doc.id)).toBe(now + 60000);
        ready = true; await jest.advanceTimersByTimeAsync(59999);
        expect(download).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(download).toHaveBeenCalledTimes(1); expect(sync.snapshot().state).toBe('synced');
        expect(sync.takes.nextRetryAt(doc.id)).toBe(0);
        expect((await loadBeatTake('take-1'))?.state).toBe('committed');
    } finally { sync.dispose(); download.mockRestore(); }
});
