import { shareStemFile, sweepStemFiles } from '../src/lib/music/stemFiles';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Stems from '../src/app/(app)/music/stems';
import Crop from '../src/app/(app)/music/crop';
import MusicLibrary from '../src/app/(app)/music/index';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { MusicActionQuoteCard } from '../src/components/music/MusicActionQuoteCard';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { t, rawText } from '../src/lib/i18n';
import { actionSong, actionQuote, stemStart, stemReplay, stemRequest, stemArchive, cropResult, croppedSong, SONG_ID } from './fixtures/musicActions';
const mockApi = { request: jest.fn() }, mockPush = jest.fn();
jest.mock('../src/lib/music/stemFiles', () => ({ shareStemFile: jest.fn(async () => {}), sweepStemFiles: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }),
    useFocusEffect: (fn: () => (() => void) | void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: (props: Record<string, unknown>) =>
    require('react').createElement(require('react-native').View, { ...props, testID: 'music-player' }) }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const click = async (label: string) => { await act(async () => button(label).props.onClick({ nativeEvent: {} })); };
const mountStems = async () => { await act(async () => root.render(<Stems />)); };
const review = async () => {
    const rights = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0];
    await act(async () => rights.props.onClick({ nativeEvent: {} })); await click(t('musicActions.action.review'));
};
const confirmStems = () => click(t('musicActions.action.confirm', { credits: actionQuote.total_credits }));
const edit = async (key: 'start' | 'end', value: string) => {
    const field = root.container.queryAll(n => n.props.accessibilityLabel === t(`musicActions.crop.${key}`) && typeof n.props.onChangeText === 'function')[0];
    await act(async () => field.props.onChangeText(value));
};
const baseResponse = async (path: string): Promise<unknown> => {
    if (path.endsWith('/stem-quotes')) return actionQuote;
    if (path.endsWith('/stems')) return stemStart;
    if (path.endsWith('/archive')) return stemArchive;
    if (path.includes('/stem-requests/')) return stemRequest;
    if (path.endsWith('/crop')) return cropResult;
    if (path.endsWith('/songs?limit=50')) return { songs: [actionSong] };
    if (path.includes('library-tabs?tab=history')) return { songs: [] };
    if (path.includes('library-tabs?tab=hooks')) return { hooks: [] };
    return actionSong;
};
beforeEach(async () => {
    RN.AppState.currentState = 'active'; resetCacheUser(); resetNetworkState(); await bindCacheUser('action-screen-user');
    jest.clearAllMocks(); mockApi.request.mockImplementation(baseResponse); jest.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); jest.useRealTimers(); resetNetworkState(); });
test('rights are required; review displays server price, balance and attempt-charge copy before any spend', async () => {
    await mountStems(); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    expect(text(t('musicActions.stems.charge')).length).toBeGreaterThan(0); await review();
    expect(text(t('musicActions.action.price', { credits: actionQuote.total_credits })).length).toBeGreaterThan(0);
    expect(text(t('musicActions.action.balance', { balance: 100, after: 95 })).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/stems'))).toHaveLength(0);
    await confirmStems(); expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/stems'))).toHaveLength(1);
    expect(text(t('musicActions.stems.queued')).length).toBeGreaterThan(0);
});
test('unaffordable and expired quotes disable Confirm while ambiguous recovery remains usable', async () => {
    const onConfirm = jest.fn(); const quote = { ...actionQuote, affordable: false, expires_at: '2000-01-01T00:00:00Z' };
    await act(async () => root.render(<MusicActionQuoteCard quote={quote} ambiguous={false} busy={false} onConfirm={onConfirm} />));
    expect(button(t('musicActions.action.confirm', { credits: 5 })).props.accessibilityState.disabled).toBe(true);
    expect(text(t('musicActions.action.notAffordable')).length).toBeGreaterThan(0);
    await act(async () => root.render(<MusicActionQuoteCard quote={quote} ambiguous busy={false} onConfirm={onConfirm} />));
    expect(button(t('musicActions.action.recover', { credits: 5 })).props.accessibilityState.disabled).toBe(false);
    await click(t('musicActions.action.recover', { credits: 5 })); expect(onConfirm).toHaveBeenCalledTimes(1);
});
test('expiry timer disables an unsubmitted quote', async () => {
    const quote = { ...actionQuote, expires_at: new Date(Date.now() + 1000).toISOString() };
    await act(async () => root.render(<MusicActionQuoteCard quote={quote} ambiguous={false} busy={false} onConfirm={jest.fn()} />));
    await act(async () => jest.advanceTimersByTimeAsync(1001));
    expect(button(t('musicActions.action.confirm', { credits: 5 })).props.accessibilityState.disabled).toBe(true);
    expect(text(t('musicActions.action.expired')).length).toBeGreaterThan(0);
});
test('expired ambiguous recovery stays usable and 200 replay shows the quoted balance', async () => {
    let sends = 0;
    mockApi.request.mockImplementation((p: string) => {
        if (p.endsWith('/stem-quotes')) return { ...actionQuote, expires_at: new Date(Date.now() + 1000).toISOString() };
        if (p.endsWith('/stems')) { if (++sends === 1) throw new ApiError(503, 'stem_acceptance_unknown'); return stemReplay; }
        return baseResponse(p);
    });
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    expect(button(t('musicActions.action.recover', { credits: 5 })).props.accessibilityState.disabled).toBe(false);
    await click(t('musicActions.action.recover', { credits: 5 })); expect(text(t('musicActions.action.remaining', { balance: 95 })).length).toBeGreaterThan(0);
});
test.each(['failed', 'refunded'] as const)('terminal %s renders its own copy and no archive button', async state => {
    mockApi.request.mockImplementation(p => p.includes('/stem-requests/') ? { ...stemRequest, state } : baseResponse(p));
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(1500));
    expect(text(t(`musicActions.stems.${state}`)).length).toBeGreaterThan(0); expect(button(t('musicActions.stems.zip'))).toBeUndefined();
    expect(text(t(`musicActions.stems.${state === 'failed' ? 'refunded' : 'failed'}`))).toHaveLength(0);
});
test('ready fetches a fresh private ZIP only on each tap and shares it natively', async () => {
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(undefined);
    mockApi.request.mockImplementation(p => p.endsWith(`/stem-requests/${stemRequest.id}`) ? { ...stemRequest, state: 'ready', archive_url: '/archive' } : baseResponse(p));
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(1500));
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/archive'))).toHaveLength(0);
    await click(t('musicActions.stems.zip')); await click(t('musicActions.stems.zip'));
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/archive'))).toHaveLength(2);
    expect(open).not.toHaveBeenCalled(); expect(shareStemFile).toHaveBeenCalledTimes(2);
    expect(shareStemFile).toHaveBeenLastCalledWith({ url: stemArchive.url, mimeType: stemArchive.mime_type,
        sizeBytes: stemArchive.size_bytes, requestId: stemStart.request_id, kind: 'archive', isCurrent: expect.any(Function) });
    expect(sweepStemFiles).toHaveBeenCalled();
});
test('poll ceiling offers manual refresh without showing provider failure', async () => {
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(300000));
    expect(text(t('musicActions.action.waiting')).length).toBeGreaterThan(0); expect(text(t('musicActions.stems.failed'))).toHaveLength(0);
    const count = mockApi.request.mock.calls.length; await click(t('musicActions.action.refresh')); expect(mockApi.request).toHaveBeenCalledTimes(count + 1);
});
test.each(['stems', 'crop'])('%s call-time unavailable hides the controls', async name => {
    mockApi.request.mockRejectedValue(new ApiError(404, `music_${name === 'crop' ? 'editing' : 'stems'}_unavailable`));
    await act(async () => root.render(name === 'crop' ? <Crop /> : <Stems />));
    expect(text(t('music.off')).length).toBeGreaterThan(0);
    expect(button(t(name === 'crop' ? 'musicActions.crop.save' : 'musicActions.action.review'))).toBeUndefined();
});
test('song actions include only advertised entries on a non-trashed song', async () => {
    await act(async () => root.render(<MusicSongActions song={{ ...actionSong, actions: ['stems'] }} />));
    expect(button(t('musicActions.crop.title'))).toBeUndefined(); await click(t('musicActions.stems.title'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/stems', params: { id: SONG_ID } });
    await act(async () => root.render(<MusicSongActions song={{ ...actionSong, lifecycle_status: 'trashed' }} />));
    expect(button(t('musicActions.stems.title'))).toBeUndefined(); expect(button(t('musicActions.crop.title'))).toBeUndefined();
});
test('crop confirms with Alert, refreshes the library and labels a preview version without a price', async () => {
    let saved = false;
    mockApi.request.mockImplementation(p => {
        if (p.endsWith('/crop')) { saved = true; return { ...cropResult, render_state: 'preview_only' }; }
        if (saved && p.endsWith('/songs?limit=50')) return { songs: [{ ...croppedSong, title: 'Updated song' }] };
        if (saved && p.endsWith(`/songs/${SONG_ID}`)) return croppedSong;
        return baseResponse(p);
    });
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    await act(async () => root.render(<><MusicLibrary /><Crop /></>)); await edit('start', '0.1'); await edit('end', '3.2');
    expect(text(t('musicActions.crop.body')).length).toBeGreaterThan(0); await click(t('musicActions.crop.save'));
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/crop'))).toHaveLength(0);
    expect(alert).toHaveBeenCalledWith(rawText(t('musicActions.crop.save')), rawText(t('musicActions.crop.confirm', { start: '0.1', end: '3.2' })), expect.any(Array));
    await act(async () => alert.mock.calls[0][2]![1].onPress!());
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/crop'))).toHaveLength(1);
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/songs?limit=50'))).toHaveLength(2);
    expect(text(t('musicActions.crop.saved', { number: 2 })).length).toBeGreaterThan(0); expect(text(t('musicActions.crop.preview')).length).toBeGreaterThan(0);
    expect(text('Updated song').length).toBeGreaterThan(0); expect(button(t('musicActions.action.review'))).toBeUndefined();
});
test('crop uses measured duration to disable an out-of-range save', async () => {
    await act(async () => root.render(<Crop />)); await edit('end', '12');
    const player = root.container.queryAll(n => n.props.testID === 'music-player')[0];
    await act(async () => player.props.onDuration(10));
    expect(button(t('musicActions.crop.save')).props.accessibilityState.disabled).toBe(true); expect(text(t('musicActions.action.range')).length).toBeGreaterThan(0);
});
test('account change removes the prepared quote and dispose stops later polls', async () => {
    await mountStems(); await review(); await act(async () => bindCacheUser('different-action-user'));
    expect(button(t('musicActions.action.confirm', { credits: 5 }))).toBeUndefined();
    await review(); await confirmStems(); await act(async () => root.unmount());
    const count = mockApi.request.mock.calls.length; await act(async () => jest.advanceTimersByTimeAsync(10000)); expect(mockApi.request).toHaveBeenCalledTimes(count);
    root = createRoot();
});
test('an unavailable archive dismisses the feature and an account switch cannot open a late private link', async () => {
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(undefined);
    mockApi.request.mockImplementation(p => p.endsWith(`/stem-requests/${stemRequest.id}`) ? { ...stemRequest, state: 'ready', archive_url: '/archive' } : baseResponse(p));
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(1500));
    let finish!: (value: typeof stemArchive) => void;
    mockApi.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click(t('musicActions.stems.zip')); await act(async () => bindCacheUser('zip-other-user'));
    await act(async () => finish(stemArchive)); expect(open).not.toHaveBeenCalled(); expect(shareStemFile).not.toHaveBeenCalled();
    await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(1500));
    mockApi.request.mockRejectedValueOnce(new ApiError(404, 'music_stems_unavailable')); await click(t('musicActions.stems.zip'));
    expect(text(t('music.off')).length).toBeGreaterThan(0); expect(button(t('musicActions.stems.zip'))).toBeUndefined();
});

test.each([['stems', Stems], ['crop', Crop]] as const)('%s screen loads under StrictMode effect re-runs', async (_name, Screen) => {
    await act(async () => root.render(<StrictMode><Screen /></StrictMode>));
    expect(text(t('music.loading'))).toHaveLength(0); expect(text(actionSong.title).length).toBeGreaterThan(0);
});

test('crop plays a preview-only version unbounded so entered seconds match the server timeline', async () => {
    const preview = { ...actionSong, provenance: { render_state: 'preview_only', crop: { start_seconds: 30, end_seconds: 60 } } };
    mockApi.request.mockImplementation(p => p.endsWith(`/songs/${SONG_ID}`) ? preview : baseResponse(p));
    await act(async () => root.render(<Crop />));
    const player = root.container.queryAll(n => n.props.testID === 'music-player')[0];
    expect(player.props.input).toEqual({ songId: preview.id, jobId: preview.job_id, start: 0 });
});

test('native ZIP sharing keeps the button locked and its session callback expires on account change', async () => {
    mockApi.request.mockImplementation(p => p.endsWith(`/stem-requests/${stemRequest.id}`) ? { ...stemRequest, state: 'ready', archive_url: '/archive' } : baseResponse(p));
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(1500));
    let finish!: () => void;
    jest.mocked(shareStemFile).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await click(t('musicActions.stems.zip'));
    expect(button(t('musicActions.stems.zip')).props.accessibilityState.disabled).toBe(true);
    const { isCurrent } = jest.mocked(shareStemFile).mock.calls[0][0]; expect(isCurrent()).toBe(true);
    await act(async () => bindCacheUser('new-zip-owner')); expect(isCurrent()).toBe(false);
    await act(async () => finish());
});
test('native ZIP failures reuse the translated share error', async () => {
    mockApi.request.mockImplementation(p => p.endsWith(`/stem-requests/${stemRequest.id}`) ? { ...stemRequest, state: 'ready', archive_url: '/archive' } : baseResponse(p));
    await mountStems(); await review(); await confirmStems(); await act(async () => jest.advanceTimersByTimeAsync(1500));
    jest.mocked(shareStemFile).mockRejectedValueOnce(new ApiError(0, 'stem_share_failed'));
    await click(t('musicActions.stems.zip'));
    expect(text(t('job.shareFailed')).length).toBeGreaterThan(0);
    expect(button(t('musicActions.stems.zip')).props.accessibilityState.disabled).toBe(false);
});
