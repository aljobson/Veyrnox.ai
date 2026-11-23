import { failedTakeFixture } from './beatNativeFailedTakeFixture';
import { releaseExportPlayback } from '../src/lib/beatNative/exportPlayback';
import { uploadFixture } from './beatNativeUploadFixture';
import { act } from 'react';
import * as RN from 'react-native';
import * as Sharing from 'expo-sharing';
import { BeatExportSheet } from '../src/components/beats/BeatExportSheet';
import { beforeReplace } from '../src/lib/beatNative/recordingFinalizers';
import { addAudioRegion, resizeRegion, type BeatRemoteAsset } from '../src/lib/beatNative/doc';
import { createRoot, type Root } from 'test-renderer';
import { useBeatExport } from '../src/lib/beatNative/useBeatExport';
import { ApiError } from '../src/lib/api';
import { deferred, fixedDoc, tick, USER, OTHER, PROJECT, VERSION } from './beatNativeFixtures';
import { exportOptions, offlineFixture } from './beatNativeExportFixtures';
import { t } from '../src/lib/i18n';
import { beatStore } from '../src/lib/beatNative/store';
import * as native from '../src/lib/beatNative/nativeContext';
import { createNativeHeldAssets } from '../src/lib/beatNative/nativeHeldAssets';
const mockRequest = jest.fn(), mockRender = jest.fn(), mockShare = jest.fn(), mockSweep = jest.fn();
let mockGeneration = 0, mockOwner = USER;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: mockGeneration, beginSessionTask: () => {
    const gen = mockGeneration, user = mockOwner; return { gen, user, current: () => gen === mockGeneration && user === mockOwner };
} }) }));
const mockApi = { request: mockRequest };
jest.mock('../src/lib/beatNative/exportRender', () => ({ ...jest.requireActual('../src/lib/beatNative/exportRender'), renderNativeExport: (...args: unknown[]) => mockRender(...args) }));
jest.mock('../src/lib/beatNative/exportFiles', () => ({ shareBeatExport: (...args: unknown[]) => mockShare(...args), sweepBeatExports: () => mockSweep(), clearBeatExports: () => {} }));
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), digest: async () => new ArrayBuffer(32) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.Modal, RN.TextInput];
let root: Root, view: ReturnType<typeof useBeatExport>, recording = false;
let doc = fixedDoc();
const prepare = jest.fn(async () => {});
let heldAssets = createNativeHeldAssets();
function Harness() { view = useBeatExport(doc, prepare, recording, false, heldAssets); return null; }
const reservation = { song_id: PROJECT, version_id: VERSION, committed: false, upload_url: 'https://bucket.r2.cloudflarestorage.com/file', headers: { 'content-type': 'audio/wav' } };
let upload: ReturnType<typeof uploadFixture>, oldXHR: typeof XMLHttpRequest;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockGeneration = 0; mockOwner = USER; recording = false; doc = fixedDoc(); heldAssets = createNativeHeldAssets();
    jest.clearAllMocks(); prepare.mockResolvedValue(); mockRequest.mockRejectedValue(new ApiError(400, 'invalid_inputs'));
    jest.spyOn(native, 'loadNativeOfflineContext').mockReturnValue(offlineFixture().Context);
    mockRender.mockImplementation(async (_doc, _options, consume, deps) => { deps.progress(0, 10); await consume({ bytes: new ArrayBuffer(48), filename: 'Mix.wav', report: { gaps: ['connectReturnsVoid'] }, selection: { range: 'song' } }); });
    mockShare.mockResolvedValue(undefined); oldXHR = global.XMLHttpRequest; upload = uploadFixture(); global.XMLHttpRequest = upload.makeRequest as unknown as typeof XMLHttpRequest;
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); global.XMLHttpRequest = oldXHR; });
const mount = async () => { await act(async () => root.render(<Harness />)); };
test('release precedes render, a parity export has no compressor warning, and capture failure never renders', async () => {
    await mount(); expect(view.state).toBe('ready'); expect(view.probe).toBe('on');
    await act(async () => { await view.run(exportOptions); });
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(mockRender.mock.invocationCallOrder[0]); expect(view.state).toBe('shared');
    mockRender.mockClear(); prepare.mockRejectedValueOnce(new Error('capture'));
    await act(async () => { await view.run(exportOptions); }); expect(view.state).toBe('error'); expect(mockRender).not.toHaveBeenCalled();
});
test.each(['share', 'save'] as const)('remote %s preflights after playback release and confirms immediately before delivery', async action => {
    const remote: BeatRemoteAsset = { source: 'song', name: 'Music track', bpm: null, durationSec: 2, sourceChannels: 2, encodedBytes: 100,
        ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' } };
    doc = addAudioRegion(fixedDoc(), remote, null, 0); await mount(); mockRequest.mockClear();
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path.includes('/jobs/')) return { url: 'https://private.test/signed' };
        if (JSON.parse(String(init?.body)).action === 'reserve') return { ...reservation, committed: true };
        throw new Error('unexpected request');
    });
    await act(async () => { await view.run(exportOptions, action === 'save' ? { title: 'Remote mix', rights: false } : undefined); });
    const paths = mockRequest.mock.calls.map(call => call[0]);
    expect(paths.filter(path => path.includes('/jobs/'))).toHaveLength(2);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(mockRequest.mock.invocationCallOrder[0]);
    if (action === 'share') {
        expect(mockRequest.mock.invocationCallOrder[1]).toBeLessThan(mockShare.mock.invocationCallOrder[0]);
        expect(view.state).toBe('shared');
    } else {
        expect(paths).toEqual([expect.stringContaining('/jobs/'), expect.stringContaining('/jobs/'), '/api/v1/music/mixdowns']);
        expect(view.state).toBe('saved');
    }
});
test('recording blocks render/save; save renders a 16-bit stereo mix even when stems/24-bit selected', async () => {
    recording = true; await mount(); await act(async () => { await view.run(exportOptions); }); expect(prepare).not.toHaveBeenCalled();
    recording = false; await mount(); mockRequest.mockResolvedValueOnce({ ...reservation, committed: true });
    await act(async () => { await view.run({ ...exportOptions, bitDepth: 24, output: 'stems' }, { title: 'Mix', rights: false }); });
    expect(mockRender.mock.calls[0][1]).toMatchObject({ bitDepth: 16, output: 'mix', kind: 'song' }); expect(view.state).toBe('saved'); expect(view.message).toBe(t('beatExport.saved', { title: 'Mix' }));
});
test.each(['account', 'unmount'])('%s during reserve aborts the request and prevents PUT/commit/success', async kind => {
    await mount(); const gate = deferred<typeof reservation>(); mockRequest.mockReturnValueOnce(gate.promise);
    let job!: Promise<void>;
    await act(async () => { job = view.run(exportOptions, { title: 'Mix', rights: false }); await tick(); });
    const call = mockRequest.mock.calls.find(c => JSON.parse(c[1].body).action === 'reserve'); expect(call).toBeDefined();
    if (kind === 'account') { mockGeneration++; mockOwner = OTHER; await mount(); }
    else await act(async () => root.unmount());
    expect(call[1].signal.aborted).toBe(true);
    await act(async () => { gate.resolve(reservation); await job; });
    expect(upload.makeRequest).not.toHaveBeenCalled(); expect(mockRequest.mock.calls.some(c => JSON.parse(c[1].body).action === 'commit')).toBe(false);
    expect(view.saved).toBeNull(); if (kind === 'account') expect(view.message).toBe(t('beatExport.signIn'));
});
test('changing account after a completed save clears the old song link and success state', async () => {
    await mount(); mockRequest.mockResolvedValueOnce({ ...reservation, committed: true });
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: false }); });
    expect(view.saved?.song_id).toBe(PROJECT);
    mockGeneration++; mockOwner = OTHER; await mount();
    expect(view.saved).toBeNull(); expect(view.state).toBe('error'); expect(view.message).toBe(t('beatExport.signIn'));
});

test('N7-R1: generation change during the last share releases busy and Close works', async () => {
    const gate = deferred(), close = jest.fn();
    jest.mocked(Sharing.shareAsync).mockReturnValueOnce(gate.promise);
    mockShare.mockImplementationOnce(() => Sharing.shareAsync('file:///cache/Mix.wav'));
    const sheet = () => <BeatExportSheet doc={doc} recording={false} prepare={prepare} heldAssets={heldAssets} onClose={close} />;
    const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    await act(async () => root.render(sheet()));
    await act(async () => { const b = button(t('beatExport.render')); (b.props.onClick ?? b.props.onPress)(); await tick(); });
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
    expect(button(t('common.close')).props.accessibilityState.disabled).toBe(true);
    mockGeneration++; mockOwner = OTHER; await act(async () => root.render(sheet()));
    await act(async () => { gate.resolve(); await tick(); });
    expect(button(t('common.close')).props.accessibilityState.disabled).toBe(false);
    expect(root.container.queryAll(n => n.children.includes(t('beatExport.signIn'))).length).toBeGreaterThan(0);
    await act(async () => { const b = button(t('common.close')); (b.props.onClick ?? b.props.onPress)(); });
    expect(close).toHaveBeenCalledTimes(1);
});
test('N7-R2: double-save is refused and editing after save clears success and enables a new save', async () => {
    await mount(); mockRequest.mockResolvedValue({ ...reservation, committed: true });
    const save = { title: 'Mix', rights: false };
    await act(async () => { await view.run(exportOptions, save); await view.run(exportOptions, save); });
    expect(mockRender).toHaveBeenCalledTimes(1);
    await act(async () => view.resetSaved());
    expect(view.saved).toBeNull(); expect(view.message).toBe(''); expect(view.state).toBe('ready');
    await act(async () => { await view.run(exportOptions, { ...save, title: 'Edited mix' }); });
    expect(mockRender).toHaveBeenCalledTimes(2); expect(view.message).toBe(t('beatExport.saved', { title: 'Edited mix' }));
});
test('N7-R3: oversized save refuses before prepare, playback release or render', async () => {
    doc = resizeRegion(doc, doc.tracks[0].regions[0].id, 80 * 3840);
    await mount(); await act(async () => { await view.run(exportOptions, { title: 'Long mix', rights: false }); });
    expect(prepare).not.toHaveBeenCalled(); expect(mockRender).not.toHaveBeenCalled();
    expect(view.message).toBe(t('beatExport.size')); expect(view.busy).toBe(false);
});
test.each(['before', 'during'])('N7-R4: replacement lease held %s prepare prevents rendering', async when => {
    await mount(); let release: (() => void) | undefined;
    if (when === 'before') release = await beforeReplace(doc.id);
    else prepare.mockImplementationOnce(async () => { release = await beforeReplace(doc.id); });
    try {
        await act(async () => { await view.run(exportOptions); });
        expect(prepare).toHaveBeenCalledTimes(when === 'before' ? 0 : 1); expect(mockRender).not.toHaveBeenCalled();
        expect(view.message).toBe(t('beatTakes.replacing')); expect(view.busy).toBe(false);
    } finally { release?.(); }
});
test('N7-R5: opening the sheet sweeps old export attempts', async () => { await mount(); expect(mockSweep).toHaveBeenCalledTimes(1); });

test('N7-RV-001: failed take commit blocks render, share and save without closing the engine', async () => {
    const h = await failedTakeFixture(); doc = h.doc;
    expect(h.edit).toHaveBeenCalled(); expect(h.controller.snapshot().status).toBe('error');
    const stop = jest.fn(); prepare.mockImplementation(() => releaseExportPlayback(h.audio, { current: h.controller }, stop));
    try {
        await mount(); mockRequest.mockClear();
        for (const save of [undefined, { title: 'Mix', rights: true }]) {
            await act(async () => { await view.run(exportOptions, save); });
            expect(view.state).toBe('error'); expect(view.busy).toBe(false);
            expect(view.message).toBe(t('beatExport.takeNotPreserved'));
        }
        expect(mockRender).not.toHaveBeenCalled(); expect(mockShare).not.toHaveBeenCalled(); expect(mockRequest).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled(); expect(h.engine.close).not.toHaveBeenCalled(); expect(h.audio.current).toBe(h.engine);
    } finally { await h.controller.discard(); await h.controller.dispose(); }
});
test.each(['share', 'save'] as const)('N7-RV-005: failed %s records its action and retry repeats that action', async action => {
    await mount(); const save = action === 'save' ? { title: 'Retry mix', rights: true } : undefined;
    if (action === 'save') mockRequest.mockRejectedValueOnce(new ApiError(503, 'service_unavailable'));
    else mockShare.mockRejectedValueOnce(new Error('share failed'));
    await act(async () => { await view.run(exportOptions, save); });
    expect(view.state).toBe('error'); expect(view.failedAction).toBe(action); expect(view.busy).toBe(false);
    if (action === 'save') mockRequest.mockResolvedValueOnce({ ...reservation, committed: true });
    await act(async () => { await view.run(exportOptions, save); });
    expect(view.state).toBe(action === 'save' ? 'saved' : 'shared'); expect(view.failedAction).toBeNull();
    if (action === 'save') {
        const reservations = mockRequest.mock.calls.map(c => JSON.parse(c[1].body)).filter(b => b.action === 'reserve');
        expect(reservations).toHaveLength(2); expect(reservations[0].idempotency_key).toBe(reservations[1].idempotency_key);
        expect(reservations[1]).toMatchObject({ title: 'Retry mix', rights_confirmed: false });
        expect(mockShare).not.toHaveBeenCalled();
    } else expect(mockShare).toHaveBeenCalledTimes(2);
});
test('N7-RV-002: XHR upload progress appears in the saving state', async () => {
    await mount(); upload.hold(); mockRequest.mockResolvedValueOnce(reservation).mockResolvedValue({ ...reservation, committed: true });
    let saving!: Promise<void>;
    await act(async () => { saving = view.run(exportOptions, { title: 'Mix', rights: false }); await tick(); });
    await act(async () => upload.progress(37));
    expect(view.state).toBe('saving'); expect(view.percent).toBe(37); expect(view.message).toBe(t('beatExport.upload', { percent: 37 }));
    await act(async () => { upload.complete(); await saving; }); expect(view.state).toBe('saved');
});
const record = (userId?: string) => ({ id: doc.id, revision: 1, doc, updatedAt: doc.updatedAt, ...(userId ? { cloud: { userId, projectId: PROJECT, revision: 1 } } : {}) });
const posts = (action: string) => mockRequest.mock.calls.filter(c => JSON.parse(c[1].body).action === action);
test('a beat synced to another account cannot be saved, and playback is left alone', async () => {
    jest.spyOn(beatStore, 'getRecord').mockReturnValue(record(OTHER)); await mount();
    expect(view.foreign).toBe(true);
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: true }); });
    expect(prepare).not.toHaveBeenCalled(); expect(mockRender).not.toHaveBeenCalled(); expect(posts('reserve')).toHaveLength(0);
    expect(view.message).toBe(t('beatExport.otherAccount'));
});
test('the owner is rechecked inside save, after the render', async () => {
    const owner = jest.spyOn(beatStore, 'getRecord').mockReturnValue(record(USER)); await mount();
    expect(view.foreign).toBe(false);
    mockRender.mockImplementationOnce(async (_doc, _options, consume) => { owner.mockReturnValue(record(OTHER)); await consume({ bytes: new ArrayBuffer(48), filename: 'Mix.wav', report: { gaps: [] } }); });
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: true }); });
    expect(mockRender).toHaveBeenCalledTimes(1); expect(posts('reserve')).toHaveLength(0); expect(upload.makeRequest).not.toHaveBeenCalled();
    expect(view.message).toBe(t('beatExport.otherAccount'));
});
test('a never-synced beat stamped to another account cannot be saved; its own owner can', async () => {
    const owner = jest.spyOn(beatStore, 'getRecord').mockReturnValue({ ...record(), owner: OTHER }); await mount();
    expect(view.foreign).toBe(true);
    owner.mockReturnValue({ ...record(), owner: USER }); await act(async () => root.render(<Harness />));
    expect(view.foreign).toBe(false);
});
test('a never-synced beat has no owner stamp and can still be saved', async () => {
    jest.spyOn(beatStore, 'getRecord').mockReturnValue(record()); await mount(); expect(view.foreign).toBe(false);
    mockRequest.mockResolvedValueOnce({ ...reservation, committed: true });
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: true }); }); expect(view.state).toBe('saved');
});
test('a lost commit response retries with the same rendered bytes and key', async () => {
    await mount(); mockRequest.mockClear();
    mockRequest.mockResolvedValueOnce(reservation).mockRejectedValueOnce(new ApiError(0, 'network'));
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: false }); });
    expect(view.state).toBe('error'); expect(view.failedAction).toBe('save');
    mockRequest.mockResolvedValueOnce({ ...reservation, committed: true });
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: false }); });
    expect(view.state).toBe('saved'); expect(mockRender).toHaveBeenCalledTimes(1);
    const keys = posts('reserve').map(c => JSON.parse(c[1].body).idempotency_key);
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});
test('an edited beat is rendered again instead of reusing kept bytes', async () => {
    await mount(); mockRequest.mockClear();
    mockRequest.mockResolvedValueOnce(reservation).mockRejectedValueOnce(new ApiError(0, 'network'));
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: false }); });
    doc = { ...doc }; await mount(); mockRequest.mockResolvedValueOnce({ ...reservation, committed: true });
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: false }); });
    expect(mockRender).toHaveBeenCalledTimes(2);
});
test('the server switch going off during a save hides Save', async () => {
    await mount(); expect(view.probe).toBe('on');
    mockRequest.mockRejectedValueOnce(new ApiError(404, 'beat_library_save_unavailable'));
    await act(async () => { await view.run(exportOptions, { title: 'Mix', rights: false }); });
    expect(view.probe).toBe('off'); expect(view.message).toBe(t('beatExport.saveOff'));
});
