import { shareStemFile, sweepStemFiles } from '../src/lib/music/stemFiles';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import TargetStems from '../src/app/(app)/music/target-stems';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { MUSIC_TARGET_STEM_INSTRUMENTS, MUSIC_TARGET_STEM_DURATION_MAX } from '../src/lib/music/shared';
import { t } from '../src/lib/i18n';
import { SONG_ID, deferred } from './fixtures/musicActions';
import { targetSong, targetQuote, targetStart, targetReplay, targetRequest, targetAsset, residualAsset } from './fixtures/musicTargetStems';
const mockApi = { request: jest.fn() }, mockPush = jest.fn();
jest.mock('../src/lib/music/stemFiles', () => ({ shareStemFile: jest.fn(async () => {}), sweepStemFiles: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const control = (role: string, label?: string) => root.container.queryAll(n => n.props.accessibilityRole === role && (!label || n.props.accessibilityLabel === label))[0];
const button = (label: string) => control('button', label);
const click = async (label: string) => { await act(async () => button(label).props.onClick({ nativeEvent: {} })); };
const choose = async (instrument: string) => { await act(async () => control('radio', t(`musicTargetStems.instrument.${instrument}`)).props.onClick({ nativeEvent: {} })); };
const review = async () => {
    await choose('guitar'); await act(async () => control('checkbox').props.onClick({ nativeEvent: {} })); await click(t('musicActions.action.review'));
};
const confirm = () => click(t('musicActions.action.confirm', { credits: 4 }));
const mount = async () => { await act(async () => root.render(<TargetStems />)); };
const tick = async () => { await act(async () => jest.advanceTimersByTimeAsync(1500)); };
const assetLabel = (kind: 'target' | 'residual') => t(`musicTargetStems.${kind}`, { instrument: t('musicTargetStems.instrument.guitar') });
const baseResponse = async (p: string, init?: RequestInit): Promise<unknown> => {
    if (p.endsWith('/target-stem-quotes')) return { ...targetQuote, instrument: JSON.parse(String(init?.body)).instrument };
    if (p.endsWith('/target-stems')) return targetStart;
    if (p.endsWith('/target')) return targetAsset;
    if (p.endsWith('/residual')) return residualAsset;
    if (p.includes('/target-stem-requests/')) return targetRequest;
    return targetSong;
};
const readyResponse = (p: string, init?: RequestInit) => p.endsWith(`/target-stem-requests/${targetRequest.id}`)
    ? { ...targetRequest, state: 'ready', outputs: ['target', 'residual'] } : baseResponse(p, init);
const ready = async () => { mockApi.request.mockImplementation(readyResponse); await mount(); await review(); await confirm(); await tick(); };
beforeEach(async () => {
    RN.AppState.currentState = 'active'; resetCacheUser(); resetNetworkState(); await bindCacheUser('target-screen-user');
    jest.clearAllMocks(); mockApi.request.mockImplementation(baseResponse); jest.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); jest.useRealTimers(); resetNetworkState(); });
test('accessible single-choice picker, rights, server-measured duration and price before spend', async () => {
    await mount(); expect(control('radiogroup')).toBeDefined();
    expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    for (const instrument of MUSIC_TARGET_STEM_INSTRUMENTS) {
        const radio = control('radio', t(`musicTargetStems.instrument.${instrument}`));
        expect(RN.StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
        await choose(instrument);
        expect(control('radio', t(`musicTargetStems.instrument.${instrument}`)).props.accessibilityState).toMatchObject({ selected: true, checked: true });
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityState?.selected)).toHaveLength(1);
    }
    await review(); expect(text(t('musicTargetStems.charge')).length).toBeGreaterThan(0);
    expect(text(t('musicTargetStems.duration', { seconds: 93.25 })).length).toBeGreaterThan(0);
    expect(text(t('musicTargetStems.quoteInstrument', { instrument: t('musicTargetStems.instrument.guitar') })).length).toBeGreaterThan(0);
    expect(text(t('musicActions.action.price', { credits: 4 })).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/target-stems'))).toHaveLength(0);
    await choose('piano'); expect(button(t('musicActions.action.confirm', { credits: 4 }))).toBeUndefined();
    await click(t('musicActions.action.review')); await confirm();
    expect(text(t('musicTargetStems.state.queued')).length).toBeGreaterThan(0);
});
test('expired ambiguous replay without balance never presents 96 as actual balance after 100→96 quote, 76 actual', async () => {
    let sends = 0;
    mockApi.request.mockImplementation((p: string, init: RequestInit) => {
        if (p.endsWith('/target-stem-quotes')) return { ...targetQuote, expires_at: new Date(Date.now() + 1000).toISOString() };
        // Server accepted at balance 80 and spent four, but the acknowledgement carrying 76 was lost.
        if (p.endsWith('/target-stems')) { if (++sends === 1) throw new ApiError(503, 'target_stem_acceptance_unknown'); return targetReplay; }
        return baseResponse(p, init);
    });
    await mount(); await review(); await confirm(); await tick();
    expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    expect(control('radio', t('musicTargetStems.instrument.piano')).props.accessibilityState.disabled).toBe(true);
    await click(t('musicActions.action.recover', { credits: 4 }));
    expect(text(t('musicActions.action.remaining', { balance: 96 }))).toHaveLength(0);
    expect(text(t('musicActions.action.balance', { balance: 100, after: 96 }))).toHaveLength(0);
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes('NaN')))).toHaveLength(0);
    const sendsMade = mockApi.request.mock.calls.filter(([p]) => p.endsWith('/target-stems'));
    expect(sendsMade).toHaveLength(2); expect(sendsMade[0][1].body).toBe(sendsMade[1][1].body);
});
test.each(['queued', 'running', 'failed', 'refunded'] as const)('%s has its own status copy and no asset buttons', async state => {
    mockApi.request.mockImplementation((p, init) => p.includes('/target-stem-requests/') ? { ...targetRequest, state } : baseResponse(p, init));
    await mount(); await review(); await confirm(); await tick();
    expect(text(t(`musicTargetStems.state.${state}`)).length).toBeGreaterThan(0);
    expect(button(assetLabel('target'))).toBeUndefined(); expect(button(assetLabel('residual'))).toBeUndefined();
});
test('ready fetches each fresh asset only on each tap, with a shared double-tap lock', async () => {
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(undefined); await ready();
    expect(text(t('musicTargetStems.state.ready')).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/target') || p.endsWith('/residual'))).toHaveLength(0);
    for (const kind of ['target', 'residual'] as const) {
        const asset = kind === 'target' ? targetAsset : residualAsset, wait = deferred<typeof asset>();
        mockApi.request.mockImplementationOnce(() => wait.promise);
        const first = button(assetLabel(kind)), other = button(assetLabel(kind === 'target' ? 'residual' : 'target'));
        await act(async () => { first.props.onClick({ nativeEvent: {} }); first.props.onClick({ nativeEvent: {} }); other.props.onClick({ nativeEvent: {} }); });
        expect(shareStemFile).toHaveBeenCalledTimes(kind === 'target' ? 0 : 2);
        await act(async () => wait.resolve(asset));
        const fresh = { ...asset, url: `${asset.url}?fresh=2` }; mockApi.request.mockResolvedValueOnce(fresh);
        await click(assetLabel(kind)); expect(shareStemFile).toHaveBeenLastCalledWith({ url: fresh.url, mimeType: fresh.mime_type,
            sizeBytes: fresh.size_bytes, requestId: targetStart.request_id, kind, isCurrent: expect.any(Function) });
        expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith(`/${kind}`))).toHaveLength(2);
    }
    expect(shareStemFile).toHaveBeenCalledTimes(4); expect(open).not.toHaveBeenCalled(); expect(sweepStemFiles).toHaveBeenCalled();
});
test.each(['target', 'residual'] as const)('%s rejects non-HTTPS links before opening', async kind => {
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(undefined); await ready();
    mockApi.request.mockResolvedValueOnce({ ...targetAsset, kind, url: 'http://mock.test/unsafe' }); await click(assetLabel(kind));
    expect(open).not.toHaveBeenCalled(); expect(text(t('musicActions.action.error')).length).toBeGreaterThan(0);
});
test.each(['target', 'residual'] as const)('account change cannot open late %s asset', async kind => {
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(undefined); await ready();
    const wait = deferred<typeof targetAsset>(); mockApi.request.mockImplementationOnce(() => wait.promise); await click(assetLabel(kind));
    await act(async () => bindCacheUser('other-target-user')); await act(async () => wait.resolve({ ...targetAsset, kind }));
    expect(open).not.toHaveBeenCalled(); expect(shareStemFile).not.toHaveBeenCalled(); expect(button(assetLabel(kind))).toBeUndefined();
});
test.each(['quote', 'confirm', 'status', 'asset'])('call-time unavailable at %s hides the feature', async step => {
    const off = new ApiError(404, 'music_target_stems_unavailable');
    if (step === 'asset') { await ready(); mockApi.request.mockRejectedValueOnce(off); await click(assetLabel('target')); }
    else {
        await mount();
        if (step === 'quote') mockApi.request.mockImplementation((p, init) => { if (p.endsWith('/target-stem-quotes')) throw off; return baseResponse(p, init); });
        await review();
        if (step === 'confirm') mockApi.request.mockRejectedValueOnce(off);
        if (step !== 'quote') await confirm();
        if (step === 'status') { mockApi.request.mockRejectedValueOnce(off); await tick(); }
    }
    expect(text(t('music.off')).length).toBeGreaterThan(0); expect(button(t('musicActions.action.review'))).toBeUndefined();
});
test('duration error uses shared limit and source hold clears confirm with localized copy', async () => {
    mockApi.request.mockImplementation((p, init) => { if (p.endsWith('/target-stem-quotes')) throw new ApiError(400, 'source_duration_unavailable'); return baseResponse(p, init); });
    await mount(); await review();
    expect(text(t('musicTargetStems.durationLimit', { minutes: MUSIC_TARGET_STEM_DURATION_MAX / 60 })).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/target-stems'))).toHaveLength(0);
    mockApi.request.mockImplementation(baseResponse); await click(t('musicActions.action.review'));
    mockApi.request.mockRejectedValueOnce(new ApiError(409, 'source_held')); await confirm();
    expect(text(t('musicTargetStems.held')).length).toBeGreaterThan(0);
    expect(button(t('musicActions.action.confirm', { credits: 4 }))).toBeUndefined(); expect(button(t('musicActions.action.recover', { credits: 4 }))).toBeUndefined();
});
test('entry only appears for advertised action on an active song', async () => {
    await act(async () => root.render(<MusicSongActions song={targetSong} />)); await click(t('musicTargetStems.title'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/target-stems', params: { id: SONG_ID } });
    await act(async () => root.render(<MusicSongActions song={{ ...targetSong, actions: [] }} />)); expect(button(t('musicTargetStems.title'))).toBeUndefined();
    await act(async () => root.render(<MusicSongActions song={{ ...targetSong, lifecycle_status: 'trashed' }} />)); expect(button(t('musicTargetStems.title'))).toBeUndefined();
});
test('StrictMode loads a fresh flow and poll ceiling offers manual refresh', async () => {
    await act(async () => root.render(<StrictMode><TargetStems /></StrictMode>)); expect(text(targetSong.title).length).toBeGreaterThan(0);
    await review(); await confirm(); await act(async () => jest.advanceTimersByTimeAsync(300000));
    expect(text(t('musicActions.action.waiting')).length).toBeGreaterThan(0); const count = mockApi.request.mock.calls.length;
    await click(t('musicActions.action.refresh')); expect(mockApi.request).toHaveBeenCalledTimes(count + 1);
});

test('native target sharing locks both buttons and its session callback expires on unmount', async () => {
    await ready(); const wait = deferred<void>();
    jest.mocked(shareStemFile).mockReturnValueOnce(wait.promise);
    await click(assetLabel('target'));
    expect(button(assetLabel('target')).props.accessibilityState.disabled).toBe(true);
    expect(button(assetLabel('residual')).props.accessibilityState.disabled).toBe(true);
    const { isCurrent } = jest.mocked(shareStemFile).mock.calls[0][0]; expect(isCurrent()).toBe(true);
    await act(async () => root.unmount()); expect(isCurrent()).toBe(false);
    await act(async () => wait.resolve()); root = createRoot();
});
test('native target failures reuse the translated share error', async () => {
    await ready(); jest.mocked(shareStemFile).mockRejectedValueOnce(new ApiError(0, 'stem_share_failed'));
    await click(assetLabel('residual'));
    expect(text(t('job.shareFailed')).length).toBeGreaterThan(0);
    expect(button(assetLabel('residual')).props.accessibilityState.disabled).toBe(false);
});
