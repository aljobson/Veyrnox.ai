import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Screen from '../src/app/(app)/music/track-add';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { MUSIC_PROMPT_MAX, MUSIC_LYRICS_MAX } from '../src/lib/music/shared';
import { t } from '../src/lib/i18n';
import { SONG_ID } from './fixtures/musicActions';
import { trackSong, trackQuote, trackStart, trackReplay, trackRequest, trackReady, trackFailed, uploadFailureRefund, partFailureRefund } from './fixtures/musicTrackAdd';
const mockApi = { request: jest.fn() }, mockPush = jest.fn(), mockPlay = jest.fn();
jest.mock('../src/components/VeyLoader', () => ({ VeyLoader: () => null }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }) }));
jest.mock('../src/lib/music/useMusicPlayer', () => ({ useMusicPlayer: () => ({ state: { state: 'idle', position: 0, duration: 0 }, play: mockPlay, pause: jest.fn(), seek: jest.fn() }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.TextInput];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const controls = (role: string, label?: string) => root.container.queryAll(n => n.props.accessibilityRole === role && (!label || n.props.accessibilityLabel === label));
const button = (label: string) => controls('button', label)[0];
const click = async (label: string, role = 'button') => { await act(async () => controls(role, label)[0].props.onClick({ nativeEvent: {} })); };
const field = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
const edit = async (label: string, value: string) => { await act(async () => field(label).props.onChangeText(value)); };
const prompt = () => t('musicGenerationActions.prompt'), lyrics = () => t('musicTrackAdd.lyrics');
const review = async () => {
    await edit(prompt(), '  warm harmonies  '); await edit(lyrics(), '  Sing along  ');
    await click(t('musicTrackAdd.lyricsRights'), 'checkbox'); await click(t('musicGenerationActions.rights'), 'checkbox');
    await click(t('musicActions.action.review'));
};
const confirm = () => click(t('musicActions.action.confirm', { credits: 10 }));
const tick = async (ms = 1500) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
const baseResponse = async (p: string, init?: RequestInit): Promise<unknown> => {
    if (p.endsWith('/track-add-quotes')) return { ...trackQuote, mode: JSON.parse(String(init?.body)).mode };
    if (p.endsWith('/track-adds')) return trackStart;
    if (p.includes('/track-add-requests/')) return trackRequest;
    return trackSong;
};
const mount = async () => { await act(async () => root.render(<Screen />)); };
const posts = () => mockApi.request.mock.calls.filter(([p]) => p.endsWith('/track-adds'));
beforeEach(async () => {
    RN.AppState.currentState = 'active'; resetCacheUser(); resetNetworkState(); await bindCacheUser('track-screen-user');
    jest.clearAllMocks(); mockApi.request.mockImplementation(baseResponse); jest.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); jest.useRealTimers(); resetNetworkState(); });
test('accessible form enforces limits and rights; exact upload, part, total and length precede spend', async () => {
    await mount(); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    expect(field(prompt()).props).toMatchObject({ multiline: true, maxLength: MUSIC_PROMPT_MAX });
    expect(field(lyrics()).props).toMatchObject({ multiline: true, maxLength: MUSIC_LYRICS_MAX });
    expect(controls('radiogroup')).toHaveLength(2); expect(controls('radio')).toHaveLength(5);
    expect(controls('header').some(n => n.children.includes(t('musicTrackAdd.title')))).toBe(true);
    await review(); expect(posts()).toHaveLength(0);
    for (const value of [t('musicTrackAdd.uploadPrice', { credits: 2 }), t('musicTrackAdd.partPrice', { credits: 8 }),
        t('musicActions.action.price', { credits: 10 }), t('musicActions.action.confirm', { credits: 10 }), t('musicGenerationActions.duration', { seconds: 93.25 }),
        t('musicActions.action.balance', { balance: 100, after: 90 }), t('musicTrackAdd.charge'), t('musicTrackAdd.session')])
        expect(text(value).length).toBeGreaterThan(0);
    await confirm(); expect(posts()).toHaveLength(1);
});
test.each(['prompt', 'lyrics', 'gender', 'lyricsRights', 'rights', 'mode'])('editing %s invalidates the unsubmitted quote', async name => {
    await mount(); await review();
    if (name === 'prompt') await edit(prompt(), 'new prompt');
    if (name === 'lyrics') await edit(lyrics(), 'new lyrics');
    if (name === 'gender') await click(t('musicTrackAdd.gender.female'), 'radio');
    if (name === 'lyricsRights') await click(t('musicTrackAdd.lyricsRights'), 'checkbox');
    if (name === 'rights') await click(t('musicGenerationActions.rights'), 'checkbox');
    if (name === 'mode') await click(t('musicTrackAdd.mode.instrumental'), 'radio');
    expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined(); expect(posts()).toHaveLength(0);
});
test('mode switch clears lyrics, gender and lyrics rights, sends instrumental-safe body and resets vocals', async () => {
    await mount(); await review(); await click(t('musicTrackAdd.gender.female'), 'radio');
    await click(t('musicTrackAdd.mode.instrumental'), 'radio');
    expect(controls('radio')).toHaveLength(2); expect(field(lyrics())).toBeUndefined();
    expect(controls('radio', t('musicTrackAdd.mode.instrumental'))[0].props.accessibilityState.checked).toBe(true);
    await click(t('musicActions.action.review'));
    const body = JSON.parse(mockApi.request.mock.calls.findLast(([p]) => p.endsWith('/track-add-quotes'))![1].body);
    expect(body).toMatchObject({ mode: 'instrumental', lyrics: '', vocal_gender: 'auto', lyrics_rights_confirmed: false });
    await click(t('musicTrackAdd.mode.vocals'), 'radio'); expect(field(lyrics()).props.value).toBe('');
    expect(controls('radio', t('musicTrackAdd.gender.auto'))[0].props.accessibilityState.checked).toBe(true);
    expect(controls('checkbox', t('musicTrackAdd.lyricsRights'))[0].props.accessibilityState.checked).toBe(false);
    expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
});
test('blank and over-limit lyrics block review after a valid quote', async () => {
    await mount(); await review();
    for (const value of ['  ', 'x'.repeat(3001)]) {
        await edit(lyrics(), value); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
        expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
    }
});
test.each([undefined, 76])('503 then expired replay displays only response balance %p', async balance_after => {
    let sends = 0;
    mockApi.request.mockImplementation((p: string, init?: RequestInit) => {
        if (p.endsWith('/track-add-quotes')) return { ...trackQuote, expires_at: new Date(Date.now() + 1000).toISOString() };
        if (p.endsWith('/track-adds')) { if (++sends === 1) throw new ApiError(503, 'track_add_acceptance_unknown'); return { ...trackReplay, balance_after }; }
        return baseResponse(p, init);
    });
    await mount(); await review(); await confirm(); await tick();
    expect(field(prompt()).props.editable).toBe(false); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    await click(t('musicActions.action.recover', { credits: 10 }));
    expect(posts()).toHaveLength(2); expect(posts()[0][1].body).toBe(posts()[1][1].body);
    expect(text(t('musicActions.action.remaining', { balance: 90 }))).toHaveLength(0);
    expect(text(t('musicActions.action.balance', { balance: 100, after: 90 }))).toHaveLength(0);
    expect(text(t('musicActions.action.remaining', { balance: 76 })).length).toBe(balance_after === 76 ? 1 : 0);
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes('NaN')))).toHaveLength(0);
});
test.each([['format_unavailable', 'musicTrackAdd.format'], ['source_duration_unavailable', 'musicTrackAdd.sourceLimit']])('%s shows an actionable note without spending', async (code, key) => {
    mockApi.request.mockImplementation((p, init) => { if (p.endsWith('/track-add-quotes')) throw new ApiError(400, code); return baseResponse(p, init); });
    await mount(); await review(); expect(posts()).toHaveLength(0); expect(text(t(key, { seconds: 120 })).length).toBeGreaterThan(0);
    expect(text(code)).toHaveLength(0);
});
test('revision conflict is definitive and offers reloading instead of recovery', async () => {
    await mount(); await review(); mockApi.request.mockRejectedValueOnce(new ApiError(409, 'revision_conflict')); await confirm();
    expect(button(t('musicActions.action.recover', { credits: 10 }))).toBeUndefined();
    expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
    expect(text(t('musicActions.action.changed')).length).toBeGreaterThan(0); expect(button(t('musicActions.action.reload'))).toBeDefined();
});
test.each([
    [trackRequest, 'musicTrackAdd.uploading'], [{ ...trackRequest, state: 'running', stage: 'part_generation' }, 'musicTrackAdd.generating'],
    [trackReady, 'musicTrackAdd.ready'], [trackFailed, 'musicTrackAdd.failed'],
    [uploadFailureRefund, 'musicTrackAdd.refunded'], [partFailureRefund, 'musicTrackAdd.refunded'],
])('status %p displays plain copy %s', async (status, key) => {
    mockApi.request.mockImplementation((p, init) => p.includes('/track-add-requests/') ? status : baseResponse(p, init));
    await mount(); await review(); await confirm(); await tick(); expect(text(t(String(key)))).toHaveLength(1);
    if (key === 'musicTrackAdd.refunded') {
        expect(uploadFailureRefund).toEqual(partFailureRefund);
        const heading = controls('header').find(n => n.children.includes(t('musicTrackAdd.refunded')))!;
        expect(heading.children.join('')).toBe('A refund has been recorded for this request.');
        expect(heading.children.join('')).not.toMatch(/\d|both|all|credits/i);
    }
});
test('failed settlement times out honestly, Check again observes refund', async () => {
    mockApi.request.mockImplementation((p, init) => p.includes('/track-add-requests/') ? trackFailed : baseResponse(p, init));
    await mount(); await review(); await confirm(); await tick(300000);
    expect(text(t('musicTrackAdd.refundPending'))).toHaveLength(1); const count = mockApi.request.mock.calls.length;
    await tick(300000); expect(mockApi.request).toHaveBeenCalledTimes(count);
    mockApi.request.mockResolvedValueOnce(partFailureRefund); await click(t('musicTrackAdd.checkAgain'));
    expect(text(t('musicTrackAdd.refunded'))).toHaveLength(1); expect(button(t('musicTrackAdd.checkAgain'))).toBeUndefined();
});
test('ready offers only explicit part playback with the request id and no automatic audio fetch', async () => {
    mockApi.request.mockImplementation((p, init) => p.includes('/track-add-requests/') ? trackReady : baseResponse(p, init));
    await mount(); await review(); await confirm(); await tick(); expect(mockPlay).not.toHaveBeenCalled();
    expect(mockApi.request.mock.calls.some(([p]) => p.endsWith('/audio'))).toBe(false);
    await click(t('music.play')); expect(mockPlay).toHaveBeenCalledWith({ songId: SONG_ID, jobId: trackStart.track_job_id, trackAddRequestId: trackStart.request_id, start: 0 });
    expect(text(t('musicGenerationActions.openSong'))).toHaveLength(0);
});
test('entry requires add_track on an active song and routes to this song', async () => {
    await act(async () => root.render(<MusicSongActions song={trackSong} />)); await click(t('musicTrackAdd.title'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/track-add', params: { id: SONG_ID } });
    for (const patch of [{ actions: [] }, { actions: ['extend'] }, { lifecycle_status: 'trashed' }]) {
        await act(async () => root.render(<MusicSongActions song={{ ...trackSong, ...patch }} />)); expect(button(t('musicTrackAdd.title'))).toBeUndefined();
    }
});
test('call-time off hides the screen and advertised entry', async () => {
    await mount(); mockApi.request.mockImplementation((p, init) => { if (p.endsWith('/track-add-quotes')) throw new ApiError(404, 'music_track_add_unavailable'); return baseResponse(p, init); });
    await review(); expect(text(t('music.off')).length).toBeGreaterThan(0); expect(button(t('musicActions.action.review'))).toBeUndefined();
    await act(async () => root.render(<MusicSongActions song={trackSong} />)); expect(button(t('musicTrackAdd.title'))).toBeUndefined();
});
test('missing advertised action starts off, and StrictMode/account changes remove results', async () => {
    mockApi.request.mockResolvedValueOnce({ ...trackSong, actions: [] }); await mount(); expect(text(t('music.off')).length).toBeGreaterThan(0);
    await act(async () => root.render(<StrictMode><Screen /></StrictMode>)); await review(); await confirm();
    await act(async () => bindCacheUser('other-screen-user')); expect(button(t('music.play'))).toBeUndefined();
    const count = mockApi.request.mock.calls.length; await tick(300000); expect(mockApi.request).toHaveBeenCalledTimes(count);
});
