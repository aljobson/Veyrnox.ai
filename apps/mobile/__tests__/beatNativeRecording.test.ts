import { createTakeRecording } from '../src/lib/beatNative/takeRecording';
import { createBeatStore } from '../src/lib/beatNative/store';
import { createHistory, record, travel } from '../src/lib/beatNative/history';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { addAudioTrack, appendBeatTake, configureBeatTakeStorage, hydrateBeatTakes, loadBeatTake, pendingBeatTakes, reconcileBeatTakes, takeAsset, type SongWindow } from '../src/lib/beatNative/takeShared';
import { createRecordingTransport } from '../src/lib/beatNative/transport';
import { beforeReplace, registerRecordingFinalizer, replacementUnderway } from '../src/lib/beatNative/recordingFinalizers';
import { fakeCapture, takeIO, takeRow } from './beatNativeTakeFixtures';
import { deferred, memoryFiles } from './beatNativeFixtures';
import { t } from '../src/lib/i18n';
function harness(cycle = false) {
    const io = takeIO(); configureBeatTakeStorage(createTakeFiles(io));
    const files = memoryFiles(), store = createBeatStore(files), initial = store.newBeat('Recording');
    store.putBeat({ ...addAudioTrack(initial), tempo: { bpm: 120 }, cycle: { on: cycle, start: 3840, end: 7680 } });
    let history = createHistory(store.getBeat(initial.id)!);
    const input = fakeCapture(), trackId = store.getBeat(initial.id)!.tracks.at(-1)!.id;
    let onWindow: (w: SongWindow) => void = () => {};
    const audio = { recordingEngine: () => ({ context: input.capture.context, resume: async () => {} }), stop: jest.fn(),
        playRange: jest.fn(async options => { onWindow = options.onWindow; return { contextStart: 0 }; }) };
    const edits = jest.fn((operation, _options) => { const next = operation(store.getBeat(initial.id)!); const ok = store.putBeat(next); if (ok) history = record(history, store.getBeat(initial.id)!); return ok; });
    const controller = createTakeRecording({ current: () => store.getBeat(initial.id)!, audio: () => audio as never, edit: edits, storage: { getItem: () => null, setItem: () => {} }, t,
        permission: async () => true, capture: async () => input.capture, audioSession: () => {}, drain: async () => true });
    store.onPersisted((_id, doc) => reconcileBeatTakes(doc));
    return { io, files, store, id: initial.id, input, trackId, controller, audio, edits, window: (w: SongWindow) => onWindow(w), undo: () => { history = travel(history, 'undo'); store.putBeat(history.present); } };
}
afterEach(() => jest.useRealTimers());
test('record → durable save → undo → save → reopen retains committed audio and one history entry', async () => {
    jest.useFakeTimers(); const h = harness(); await h.store.flushBeat(h.id); await h.controller.arm(h.trackId); await h.controller.record(false);
    h.window({ fromSec: 0, toSec: 2, contextTime: 0 }); h.input.send({ frame: 0, samples: new Float32Array(2000).fill(0.3) }); await h.controller.finish();
    expect(h.edits).toHaveBeenCalledTimes(1); expect(h.edits.mock.calls[0][1].recordingCommit).toBe(true);
    const asset = Object.values(h.store.getBeat(h.id)!.assets!)[0]; if (asset.source !== 'take') throw new Error('expected_take'); const ref = asset.ref;
    expect(pendingBeatTakes(h.id)).toHaveLength(1); await h.store.flushBeat(h.id);
    h.undo(); await h.store.flushBeat(h.id); configureBeatTakeStorage(createTakeFiles(h.io)); await hydrateBeatTakes();
    expect(pendingBeatTakes(h.id)).toEqual([]); expect((await loadBeatTake(ref))?.samples.length).toBe(2000); await h.controller.dispose();
});
test('unsaved referencing document leaves pending audio recoverable', async () => {
    jest.useFakeTimers(); const h = harness(); await h.controller.arm(h.trackId); await h.controller.record(false);
    h.window({ fromSec: 0, toSec: 2, contextTime: 0 }); h.input.send({ frame: 0, samples: new Float32Array(2000) }); await h.controller.finish();
    jest.mocked(h.files.write).mockRejectedValue(new Error('disk_full')); await expect(h.store.flushBeat(h.id)).rejects.toThrow();
    await h.controller.refreshRecovery(); expect(pendingBeatTakes(h.id)).toHaveLength(1);
    configureBeatTakeStorage(createTakeFiles(h.io)); await hydrateBeatTakes(); expect(pendingBeatTakes(h.id)).toHaveLength(1); await h.controller.dispose();
});
test('nonzero cycle produces two passes and count-in passes the explicit locator to transport', async () => {
    jest.useFakeTimers(); const h = harness(true); await h.controller.arm(h.trackId); await h.controller.record(true);
    expect(h.audio.playRange.mock.calls[0][0]).toMatchObject({ startTick: 3840, cycle: { start: 3840, end: 7680 }, countInBars: 1 });
    h.window({ fromSec: 2, toSec: 4, contextTime: 2 }); h.window({ fromSec: 2, toSec: 4, contextTime: 4 });
    h.input.send({ frame: 2000, samples: new Float32Array(4000).fill(0.2) }); await h.controller.finish();
    expect(h.store.getBeat(h.id)!.tracks.at(-1)!.takeGroups?.[0].lanes).toHaveLength(2);
    expect(h.controller.snapshot().pass).toBeGreaterThanOrEqual(2); await h.controller.dispose();
});
test('checkpoint-only recovery groups recording ids, reads audio, and discard retires pending rows', async () => {
    jest.useFakeTimers(); const h = harness();
    const row = { ...takeRow('recovery', h.id), pending: { ...takeRow().pending!, trackId: h.trackId, beatId: h.id } };
    await appendBeatTake(row, 0); configureBeatTakeStorage(createTakeFiles(h.io));
    await h.controller.refreshRecovery(); expect(h.controller.snapshot().recovery).toHaveLength(1);
    await h.controller.recover(); expect(h.edits).toHaveBeenCalledTimes(1); expect(h.controller.snapshot().recovery).toEqual([]);
    const another = { ...row, id: 'discard-me' }; await appendBeatTake(another, 0); await h.controller.refreshRecovery(); await h.controller.recover(true);
    expect(pendingBeatTakes(h.id).map(row => row.id)).toEqual(['recovery']);
    await h.store.flushBeat(h.id); expect(pendingBeatTakes(h.id)).toEqual([]); await h.controller.dispose();
});
test('read-only refuses permission and replacement lease finalizes before any replacement starts', async () => {
    jest.useFakeTimers(); const h = harness(); const unreg = registerRecordingFinalizer(h.id, h.controller.beforeReplace);
    await h.controller.arm(h.trackId); await h.controller.record(false);
    h.window({ fromSec: 0, toSec: 1, contextTime: 0 }); h.input.send({ frame: 0, samples: new Float32Array(1000) });
    const release = await beforeReplace(h.id); expect(replacementUnderway(h.id)).toBe(true); expect(h.edits).toHaveBeenCalledTimes(1);
    await h.controller.arm(h.trackId); expect(h.controller.snapshot().armedId).toBeNull(); release(); unreg();
    const permission = jest.fn(); const controller = createTakeRecording({ current: () => ({ ...h.store.getBeat(h.id)!, version: 5 }), audio: () => null, edit: () => true, storage: { getItem: () => null, setItem: () => {} }, t, permission, audioSession: () => {} });
    await controller.arm(h.trackId); expect(permission).not.toHaveBeenCalled(); await controller.dispose(); await h.controller.dispose();
});
test('transport maps nonzero cycles, four count-in clicks, and non-cycle windows beyond original song end', async () => {
    jest.useFakeTimers(); const h = harness(true), context = h.input.capture.context, windows: SongWindow[] = [];
    let fire = () => {}; const engine = { context, now: () => context.currentTime, resume: async () => {}, click: jest.fn(), playPad: jest.fn() };
    const transport = createRecordingTransport(engine as never, () => ({}), () => {}, fn => { fire = fn; return 1; }, () => {});
    const result = await transport.play({ getDoc: () => h.store.getBeat(h.id)!, startTick: 3840, endTick: 7680, cycle: { start: 3840, end: 7680 }, countInBars: 1, onWindow: w => windows.push(w) });
    expect(result.contextStart).toBe(0.1); expect(engine.click.mock.calls.map(c => c[0])).toEqual([0.1, 0.6, 1.1, 1.6]);
    context.currentTime = 6; fire(); expect(windows.every(w => w.fromSec >= 2 && w.toSec <= 4)).toBe(true); expect(windows.some(w => w.contextTime >= 4.1)).toBe(true);
    transport.stop(); windows.length = 0; context.currentTime = 0;
    await transport.play({ getDoc: () => h.store.getBeat(h.id)!, startTick: 0, endTick: 100_000, cycle: null, countInBars: 0, onWindow: w => windows.push(w) });
    context.currentTime = 20; fire(); expect(windows.at(-1)!.toSec).toBeGreaterThan(20); transport.stop(); await h.controller.dispose();
});

test('recording keeps four count-in clicks and adds straight live metronome clicks after the origin', async () => {
    jest.useFakeTimers(); const h = harness(), context = h.input.capture.context;
    let fire = () => {}, now = 0;
    const destination = { kind: 'recording-master' };
    const engine = { context, now: () => now, resume: async () => {}, click: jest.fn(), playPad: jest.fn() };
    let doc = { ...h.store.getBeat(h.id)!, tempo: { bpm: 120 }, swing: 0.6, metronome: true };
    const clickOutput = jest.fn(() => destination);
    const transport = createRecordingTransport(engine as never, () => ({}), () => {}, fn => { fire = fn; return 1; }, () => {}, clickOutput);
    await transport.play({ getDoc: () => doc, startTick: 0, endTick: 3840, cycle: null, countInBars: 1, onWindow: () => {} });
    for (let i = 1; i <= 10; i++) { now = i * 0.2; context.currentTime = now; fire(); }
    now = 2.5; context.currentTime = now; fire();
    expect(engine.click.mock.calls.map(call => call.slice(0, 2))).toEqual([
        [0.1, true], [0.6, false], [1.1, false], [1.6, false], [2.1, true], [2.6, false],
    ]);
    expect(engine.click.mock.calls.every(call => call[2] === destination)).toBe(true);
    doc = { ...doc, metronome: false }; now = 3; context.currentTime = now; fire();
    expect(engine.click).toHaveBeenCalledTimes(6);
    transport.stop(); now = 4; context.currentTime = now; fire(); expect(engine.click).toHaveBeenCalledTimes(6);
    await h.controller.dispose();
});

test('all shared-session announcements map to mobile strings, including the eight-pass limit', async () => {
    jest.useFakeTimers(); const h = harness(true), messages: string[] = [];
    const off = h.controller.subscribe(() => messages.push(h.controller.snapshot().error));
    await h.controller.arm(h.trackId); await h.controller.record(false);
    for (let pass = 0; pass < 8; pass++) h.window({ fromSec: 2, toSec: 4, contextTime: pass * 2 });
    h.input.send({ frame: 0, samples: new Float32Array(16000).fill(0.25) }); await h.controller.finish();
    expect(messages).toContain(t('beatTakes.takeLimit'));
    expect(messages.some(message => message.includes('app.music.'))).toBe(false);
    expect(h.edits.mock.calls[0][1].message).toBe(t('beatTakes.recorded', { count: 8, take: 8 }));
    const { recordingTranslator } = require('../src/lib/beatNative/takeRecording');
    for (const key of ['d27', 'd35', 'd36', 'd37', 'd38', 'd39']) {
        expect(recordingTranslator(t)(`app.music.beat.details.${key}`, { count: 1, take: 1, bar: 2 })).not.toMatch(/app\.music\.|beatTakes\./);
    }
    expect(recordingTranslator(t)('app.music.beat.compat.readOnly')).toBe(t('beatTakes.readOnly'));
    off(); await h.controller.dispose();
});

test('a cloud replacement leaves an idle armed microphone open', async () => {
    jest.useFakeTimers(); const h = harness(); await h.controller.arm(h.trackId);
    const unregister = registerRecordingFinalizer(h.id, h.controller.beforeReplace);
    const release = await beforeReplace(h.id);
    expect(h.controller.snapshot().armedId).toBe(h.trackId); expect(h.input.capture.ended).toBe(false);
    release(); unregister(); await h.controller.dispose();
});

test('replacement cancels a pending recording start and releases the recording lock', async () => {
    jest.useFakeTimers(); const h = harness(), gate = deferred<string[]>();
    await h.controller.arm(h.trackId);
    configureBeatTakeStorage(createTakeFiles({ ...h.io, list: () => gate.promise }));
    const starting = h.controller.record(false);
    expect(h.controller.snapshot().status).toBe('opening');
    const unregister = registerRecordingFinalizer(h.id, h.controller.beforeReplace);
    const replacing = beforeReplace(h.id);
    gate.resolve([]); await starting;
    const release = await replacing;
    expect(h.audio.playRange).not.toHaveBeenCalled();
    expect(h.controller.snapshot()).toMatchObject({ status: 'armed', armedId: h.trackId });
    release(); expect(h.controller.locked()).toBe(false);
    unregister(); await h.controller.dispose();
});

test('failed save, recovery refresh and Discard leave a live take pending until a successful save', async () => {
    jest.useFakeTimers(); const h = harness(); await h.store.flushBeat(h.id);
    await h.controller.arm(h.trackId); await h.controller.record(false);
    h.window({ fromSec: 0, toSec: 2, contextTime: 0 });
    h.input.send({ frame: 0, samples: new Float32Array(2000).fill(0.3) }); await h.controller.finish();
    const asset = Object.values(h.store.getBeat(h.id)!.assets!)[0]; if (asset.source !== 'take') throw new Error('expected_take'); const ref = asset.ref;
    jest.mocked(h.files.write).mockRejectedValueOnce(new Error('disk_full'));
    await expect(h.store.flushBeat(h.id)).rejects.toThrow('disk_full');
    await h.controller.refreshRecovery(h.store.getPersistedBeat(h.id));
    expect(h.controller.snapshot().recovery).toEqual([]);
    await h.controller.recover(true);
    expect((await loadBeatTake(ref))?.state).toBe('pending');
    await h.store.flushBeat(h.id);
    configureBeatTakeStorage(createTakeFiles(h.io)); await hydrateBeatTakes();
    expect((await loadBeatTake(ref))?.state).toBe('committed');
    expect((await loadBeatTake(ref))?.samples.length).toBe(2000);
    await h.controller.dispose();
});

test('Discard rechecks a recovery row that became referenced after the panel refreshed', async () => {
    jest.useFakeTimers(); const h = harness(); const row = takeRow('stale-recovery', h.id);
    await appendBeatTake(row, 0); await h.controller.refreshRecovery();
    expect(h.controller.snapshot().recovery).toHaveLength(1);
    expect(h.store.putBeat({ ...h.store.getBeat(h.id)!, assets: { a1: takeAsset(row) } })).toBe(true);
    await h.controller.recover(true);
    expect((await loadBeatTake(row.id))?.state).toBe('pending');
    await h.store.flushBeat(h.id); expect((await loadBeatTake(row.id))?.state).toBe('committed');
    await h.controller.dispose();
});

test('replacement settles every registered recorder in order, retains peers on unregister, and blocks on any rejection', async () => {
    const id = 'multi-finalizer', order: string[] = [];
    const first = registerRecordingFinalizer(id, async () => { order.push('first'); throw new Error('midi_failed'); });
    const removed = registerRecordingFinalizer(id, async () => { order.push('removed'); });
    const last = registerRecordingFinalizer(id, async () => { order.push('last'); });
    removed();
    await expect(beforeReplace(id)).rejects.toThrow('midi_failed');
    expect(order).toEqual(['first', 'last']); expect(replacementUnderway(id)).toBe(false);
    first(); last();
});
