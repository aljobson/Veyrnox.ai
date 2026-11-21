import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Screen from '../src/app/(app)/music/render';
import { MusicRenderBody } from '../src/components/music/MusicRenderBody';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { createRenderFlow } from '../src/lib/music/renderFlow';
import * as playerModule from '../src/components/music/MusicPlayer';
import { ApiError, type ApiClient } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { markRenderUnavailable } from '../src/lib/music/renderAvailability';
import { t } from '../src/lib/i18n';
import { SONG_ID, VERSION_ID, deferred } from './fixtures/musicActions';
import { renderSong, renderedSong, renderCreated, renderEarlyReplay } from './fixtures/musicRender';
const mockApi = { request: jest.fn() }, mockPush = jest.fn(), mockPlay = jest.fn();
let mockDuration = 0;
jest.mock('../src/components/VeyLoader', () => ({ VeyLoader: () => null }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }) }));
jest.mock('../src/lib/music/useMusicPlayer', () => ({ useMusicPlayer: () => ({ state: { state: 'idle', position: 0, duration: mockDuration }, play: mockPlay, pause: jest.fn(), seek: jest.fn() }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const controls = (role: string, label?: string) => root.container.queryAll(n => n.props.accessibilityRole === role && (!label || n.props.accessibilityLabel === label));
const button = (label: string) => controls('button', label)[0];
const click = async (label: string, role = 'button') => { await act(async () => controls(role, label)[0].props.onClick({ nativeEvent: {} })); };
const mount = async () => { await act(async () => root.render(<Screen />)); };
const posts = () => mockApi.request.mock.calls.filter(([p]) => p.endsWith('/render'));
beforeEach(async () => {
    resetCacheUser(); resetNetworkState(); await bindCacheUser('render-screen-user'); jest.clearAllMocks(); mockDuration = 0;
    mockApi.request.mockImplementation(async (p: string, init?: RequestInit) => p.endsWith('/render') ? { ...renderCreated, operation: JSON.parse(String(init?.body)).operation } : renderSong);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); resetNetworkState(); });
test('entry requires render and active lifecycle, navigates to render, and respects account availability', async () => {
    await act(async () => root.render(<MusicSongActions song={renderSong} />)); await click(t('musicRender.title'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/render', params: { id: SONG_ID } });
    for (const patch of [{ actions: ['speed', 'reverse'] }, { lifecycle_status: 'trashed' }]) {
        await act(async () => root.render(<MusicSongActions song={{ ...renderSong, ...patch }} />)); expect(button(t('musicRender.title'))).toBeUndefined();
    }
    await act(async () => { root.render(<MusicSongActions song={renderSong} />); markRenderUnavailable('editing'); });
    expect(button(t('musicRender.title'))).toBeUndefined(); await act(async () => bindCacheUser('next-user')); expect(button(t('musicRender.title'))).toBeDefined();
});
test('unmeasured fade/reorder disabled, speed requires render alone, reverse is separately advertised', async () => {
    mockApi.request.mockResolvedValue({ ...renderSong, actions: ['render'] }); await mount();
    expect(text(t('musicRender.measure')).length).toBeGreaterThan(0);
    for (const name of ['fade', 'reorder']) expect(controls('radio', t(`musicRender.${name}`))[0].props.accessibilityState.disabled).toBe(true);
    expect(controls('radio', t('musicRender.reverse'))).toHaveLength(0);
    await click(t('musicRender.speed'), 'radio'); expect(button(t('musicRender.save')).props.accessibilityState.disabled).toBe(false);
    expect(text(t('musicRender.body')).length).toBeGreaterThan(0);
});
test('measured duration enables stepped controls and all operation controls', async () => {
    mockDuration = 12; await mount();
    expect(controls('radio', t('musicRender.fade'))[0].props.accessibilityState.disabled).toBe(false);
    expect(root.container.queryAll(n => typeof n.props.onChangeText === 'function')).toHaveLength(0);
    await click(t('musicRender.more', { field: t('musicRender.fadeIn') }));
    await click(t('musicRender.save')); expect(JSON.parse(posts()[0][1].body).fade_in_seconds).toBe(1.5);
});
test.each(['speed', 'reorder', 'remaster', 'reverse'])('%s controls submit exact parameters', async operation => {
    mockDuration = 12; await mount(); await click(t(`musicRender.${operation}`), 'radio');
    if (operation === 'speed') await click(t('musicRender.more', { field: t('musicRender.speed') }));
    if (operation === 'reorder') await click(t('musicRender.more', { field: t('musicRender.split') }));
    if (operation === 'remaster') await click('-3 dBFS', 'radio');
    await click(t('musicRender.save'));
    const body = JSON.parse(posts()[0][1].body);
    expect(body.operation).toBe(operation);
    if (operation === 'speed') expect(body.speed_ratio).toBe(1.15);
    if (operation === 'reorder') expect(body).toMatchObject({ split_seconds: 1.5, order: [2, 1] });
    if (operation === 'remaster') expect(body.target_peak_dbfs).toBe(-3);
    if (operation === 'reverse') expect(Object.keys(body).sort()).toEqual(['idempotency_key', 'operation', 'version_id']);
});
test('pending and ambiguous states lock inputs, retry uses exact body, replay mismatch has no Play', async () => {
    mockDuration = 12; await mount(); const wait = deferred<never>(); mockApi.request.mockReturnValueOnce(wait.promise);
    await click(t('musicRender.save')); expect(button(t('musicRender.saving')).props.accessibilityState.disabled).toBe(true);
    expect(controls('radio').every(n => n.props.accessibilityState.disabled)).toBe(true);
    await act(async () => wait.reject(new ApiError(502, 'temporarily_unavailable')));
    expect(button(t('musicRender.retry'))).toBeDefined(); expect(text(t('musicRender.uncertain')).length).toBeGreaterThan(0);
    mockApi.request.mockResolvedValueOnce(renderEarlyReplay).mockResolvedValueOnce(renderSong);
    await click(t('musicRender.retry')); expect(posts()[1][1].body).toBe(posts()[0][1].body);
    expect(text(t('musicRender.saved', { number: 2 })).length).toBeGreaterThan(0);
    expect(text(t('musicRender.currentChanged')).length).toBeGreaterThan(0); expect(button(t('music.play'))).toBeUndefined();
    await click(t('musicRender.openCurrent')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/[id]', params: { id: SONG_ID } });
});
test('exact refreshed result offers explicit playback and Back to song', async () => {
    mockDuration = 12; await mount(); mockApi.request.mockResolvedValueOnce(renderCreated).mockResolvedValueOnce(renderedSong);
    await click(t('musicRender.save')); expect(mockPlay).not.toHaveBeenCalled(); await click(t('music.play'));
    expect(mockPlay).toHaveBeenCalledWith(expect.objectContaining({ jobId: renderedSong.job_id }));
    expect(button(t('musicRender.back'))).toBeDefined(); expect(button(t('musicRender.save'))).toBeUndefined();
});
test('refresh error preserves saved result, exposes refresh and hides result Play until verified', async () => {
    mockDuration = 12; await mount(); mockApi.request.mockResolvedValueOnce(renderCreated).mockRejectedValueOnce(new Error('refresh'));
    await click(t('musicRender.save')); expect(button(t('music.play'))).toBeUndefined();
    expect(text(t('musicRender.refreshFailed')).length).toBeGreaterThan(0);
    mockApi.request.mockResolvedValueOnce(renderedSong); await click(t('musicRender.refresh')); expect(button(t('music.play'))).toBeDefined(); expect(posts()).toHaveLength(1);
});
test('loading, load failure, retry and unavailable states have specific controls', async () => {
    const wait = deferred<never>(); mockApi.request.mockReturnValueOnce(wait.promise); await mount(); expect(text(t('music.loading')).length).toBeGreaterThan(0);
    await act(async () => wait.reject(new ApiError(404, 'not_found'))); expect(text(t('musicRender.missing')).length).toBeGreaterThan(0);
    await click(t('music.retry')); mockDuration = 12;
    mockApi.request.mockRejectedValueOnce(new ApiError(404, 'music_editing_unavailable'));
    await click(t('musicRender.speed'), 'radio'); await click(t('musicRender.save'));
    expect(text(t('musicRender.editingOff')).length).toBeGreaterThan(0); expect(button(t('musicRender.save'))).toBeUndefined();
});
test('reverse off hides reverse picker but retains other operations', async () => {
    await mount(); await click(t('musicRender.reverse'), 'radio'); mockApi.request.mockRejectedValueOnce(new ApiError(404, 'music_reverse_unavailable'));
    await click(t('musicRender.save')); expect(controls('radio', t('musicRender.reverse'))).toHaveLength(0);
    expect(text(t('musicRender.reverseOff')).length).toBeGreaterThan(0); await click(t('musicRender.speed'), 'radio');
    expect(button(t('musicRender.save')).props.accessibilityState.disabled).toBe(false);
});
test('StrictMode revives a fresh flow and account change clears success', async () => {
    mockDuration = 12; await act(async () => root.render(<StrictMode><Screen /></StrictMode>));
    mockApi.request.mockResolvedValueOnce(renderCreated).mockResolvedValueOnce(renderedSong); await click(t('musicRender.save'));
    await act(async () => bindCacheUser('next-user')); expect(text(t('musicRender.saved', { number: 2 }))).toHaveLength(0);
});
test('old source duration callback is dropped after a source reload', async () => {
    const flow = createRenderFlow(mockApi as unknown as ApiClient, SONG_ID); await flow.load();
    let oldCallback!: (seconds: number) => void;
    const Original = playerModule.MusicPlayer;
    const spy = jest.spyOn(playerModule, 'MusicPlayer').mockImplementation(props => {
        oldCallback = props.onDuration!; return <Original {...props} />;
    });
    await act(async () => root.render(<MusicRenderBody flow={flow} state={flow.snapshot()} />));
    mockApi.request.mockResolvedValueOnce(renderedSong); await flow.load(); oldCallback(99);
    expect(flow.snapshot().duration).toBeNull(); expect(flow.snapshot().song?.version_id).not.toBe(VERSION_ID); flow.dispose(); spy.mockRestore();
});
test('failed initial network read describes loading, never an unsubmitted save', async () => {
    mockApi.request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await mount();
    expect(text(t('music.loadError')).length).toBeGreaterThan(0); expect(text(t('musicRender.uncertain'))).toHaveLength(0);
});
