import * as latencyModule from '../src/lib/beatNative/latencyStore';
import { deferred } from './beatNativeFixtures';
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatRecordPanel } from '../src/components/beats/BeatRecordPanel';
import { BeatTakeLanes } from '../src/components/beats/BeatTakeLanes';
import { createTakeRecording } from '../src/lib/beatNative/takeRecording';
import { addAudioTrack, commitRecording, configureBeatTakeStorage, putBeatTake, takeAsset } from '../src/lib/beatNative/takeShared';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { fixedDoc } from './beatNativeFixtures';
import { takeIO, takeRow } from './beatNativeTakeFixtures';
import { t } from '../src/lib/i18n';
void [RN.View, RN.Modal, RN.Pressable, RN.Text];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); configureBeatTakeStorage(createTakeFiles(takeIO())); });
afterEach(async () => { await act(async () => root.unmount()); });
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
test('Arm denial renders an alert and Open Settings, then rechecks permission on retry', async () => {
    const doc = addAudioTrack(fixedDoc()), track = doc.tracks.at(-1)!, permission = jest.fn(async () => false);
    const controller = createTakeRecording({ current: () => doc, audio: () => null, edit: () => true, storage: { getItem: () => null, setItem: () => {} }, t, permission, audioSession: () => {} });
    function Panel() { const view = require('react').useSyncExternalStore(controller.subscribe, controller.snapshot); return <BeatRecordPanel doc={doc} controller={controller} view={view} playing={false} />; }
    await act(async () => root.render(<Panel />));
    const arm = () => { const b = button(t('beatTakes.arm', { track: track.name })); return (b.props.onClick ?? b.props.onPress)(); };
    await act(async () => { await arm(); });
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert' && n.children.includes(t('beatTakes.permissionDenied'))).length).toBeGreaterThan(0);
    expect(button(t('beatTakes.settings'))).toBeDefined();
    await act(async () => { await arm(); }); expect(permission).toHaveBeenCalledTimes(2); await controller.dispose();
});
test('Android arm is disabled with explanation, without requesting permission', async () => {
    const previous = RN.Platform.OS; Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'android' });
    try {
        const doc = addAudioTrack(fixedDoc()), permission = jest.fn();
        const controller = createTakeRecording({ current: () => doc, audio: () => null, edit: () => true, storage: { getItem: () => null, setItem: () => {} }, t, permission });
        await act(async () => root.render(<BeatRecordPanel doc={doc} controller={controller} view={controller.snapshot()} playing={false} />));
        const arm = button(t('beatTakes.arm', { track: doc.tracks.at(-1)!.name })); expect(arm.props.accessibilityState?.disabled ?? arm.props.disabled).toBe(true);
        expect(root.container.queryAll(n => n.children.includes(t('beatTakes.android'))).length).toBeGreaterThan(0); expect(permission).not.toHaveBeenCalled();
    } finally { Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: previous }); }
});
test('lanes have named waveform and actions; lane edits use the supplied history path', async () => {
    const original = addAudioTrack({ ...fixedDoc(), tempo: { bpm: 120 } }), row = takeRow(); await putBeatTake(row);
    const doc = commitRecording(original, { trackId: original.tracks.at(-1)!.id, start: 0, length: 1920, takes: [{ asset: takeAsset(row) }] }); const apply = jest.fn(() => true);
    await act(async () => root.render(<BeatTakeLanes doc={doc} track={doc.tracks.at(-1)!} apply={apply} locked={false} />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('beatTakes.waveform', { name: t('beatTakes.take', { n: 1 }), seconds: '1.0' })).length).toBeGreaterThan(0);
    const choose = button(t('beatTakes.choose', { name: t('beatTakes.take', { n: 1 }) })); await act(async () => (choose.props.onClick ?? choose.props.onPress)()); expect(apply).toHaveBeenCalledTimes(1);
});


test('the record panel updates after latency hydration without a document or recording state change', async () => {
    const io = takeIO(), gate = deferred<Uint8Array | null>(), storage = latencyModule.createLatencyStorage({ ...io, read: () => gate.promise });
    const singleton = jest.spyOn(latencyModule, 'latencyStorage').mockReturnValue(storage);
    try {
        const doc = addAudioTrack(fixedDoc());
        const controller = createTakeRecording({ current: () => doc, audio: () => null, edit: () => true, storage, t });
        const view = { ...controller.snapshot(), armedId: doc.tracks.at(-1)!.id };
        await act(async () => root.render(<BeatRecordPanel doc={doc} controller={controller} view={view} playing={false} />));
        expect(root.container.queryAll(n => n.children.includes(t('beatTakes.notCalibrated'))).length).toBeGreaterThan(0);
        const hydration = storage.hydrate();
        await act(async () => {
            gate.resolve(new TextEncoder().encode(JSON.stringify({ 'veyrnox.beat.latency.v1': JSON.stringify({ default: { ms: 43, measuredAt: Date.now() } }) })));
            await hydration;
        });
        expect(root.container.queryAll(n => n.children.includes(t('beatTakes.latency', { ms: 43 }))).length).toBeGreaterThan(0);
    } finally { singleton.mockRestore(); }
});
