import { addAudioTrack, audioRecordingRange, createAudioRecording, splitPasses, capturedSamples, commitRecording, setComp, useWholeTake, setCrossfade, flattenGroup, deleteLane, recoverTake, beatReadOnly } from '../src/lib/beatNative/takeShared';
import { createBeat, validateBeat } from '../src/lib/beatNative/doc';
test('web modules actually import without touching browser capture or IndexedDB', () => {
    for (const fn of [createAudioRecording, splitPasses, capturedSamples, commitRecording, setComp, useWholeTake, setCrossfade, flattenGroup, deleteLane, recoverTake]) expect(typeof fn).toBe('function');
    const doc = addAudioTrack(createBeat({ id: '33333333-3333-4333-8333-333333333333' }));
    expect(validateBeat(doc).ok).toBe(true); expect(doc.tracks.at(-1)?.kind).toBe('audio');
    const cycle = { ...doc, cycle: { on: true, start: 3840, end: 7680 } };
    expect(audioRecordingRange(cycle, cycle.cycle.start)).toEqual({ start: 3840, length: 3840, cycle: true });
    expect(() => audioRecordingRange({ ...cycle, cycle: { on: true, start: 3840, end: 4080 } }, 3840)).toThrow();
    expect(beatReadOnly({ ...doc, version: 5 })).toBe(true);
});

test('a cold seam configures native storage before the first take read, without a parent effect', async () => {
    const { createTakeFiles } = require('../src/lib/beatNative/takeFiles');
    const { takeIO, takeRow } = require('./beatNativeTakeFixtures');
    const io = takeIO(), adapter = createTakeFiles(io), row = takeRow(); await adapter.put(row); await adapter.putState(row);
    let load!: (id: string) => Promise<{ samples: Float32Array } | null>;
    try {
        jest.isolateModules(() => {
            jest.doMock('../src/lib/beatNative/takeFiles', () => ({ ...jest.requireActual('../src/lib/beatNative/takeFiles'), createTakeFiles: () => createTakeFiles(io) }));
            load = require('../src/lib/beatNative/takeShared').loadBeatTake;
        });
        expect((await load(row.id))?.samples).toEqual(row.samples);
    } finally { jest.dontMock('../src/lib/beatNative/takeFiles'); }
});
