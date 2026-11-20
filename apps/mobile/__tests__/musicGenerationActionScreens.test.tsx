import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Extend from '../src/app/(app)/music/extend';
import Cover from '../src/app/(app)/music/cover';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { MusicCandidateCard, candidatePlayback } from '../src/components/music/MusicCandidateCard';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { MUSIC_COVER_PROMPT_MAX, MUSIC_EXTEND_DURATION_MAX, MUSIC_COVER_DURATION_MAX } from '../src/lib/music/shared';
import { t } from '../src/lib/i18n';
import { SONG_ID } from './fixtures/musicActions';
import { generationSong, extendQuote, coverQuote, generationStart, generationReplay, generationView, readyView } from './fixtures/musicGenerationActions';
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
const click = async (label: string) => { await act(async () => button(label).props.onClick({ nativeEvent: {} })); };
const field = () => root.container.queryAll(n => n.props.accessibilityLabel === t('musicGenerationActions.prompt') && typeof n.props.onChangeText === 'function')[0];
const edit = async (value: string) => { await act(async () => field().props.onChangeText(value)); };
const rights = async () => { await act(async () => controls('checkbox')[0].props.onClick({ nativeEvent: {} })); };
const review = async () => { await edit('  warm piano  '); await rights(); await click(t('musicActions.action.review')); };
const confirm = () => click(t('musicActions.action.confirm', { credits: 10 }));
const tick = async (ms = 1500) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
for (const kind of ['extend', 'cover'] as const) describe(kind, () => {
    const Screen = kind === 'extend' ? Extend : Cover, quote = kind === 'extend' ? extendQuote : coverQuote;
    const baseResponse = async (p: string, init?: RequestInit): Promise<unknown> => {
        if (p.endsWith(`/${kind}-quotes`)) return { ...quote, ...(kind === 'cover' ? { source_influence: JSON.parse(String(init?.body)).source_influence } : {}) };
        if (p.endsWith(`/${kind}s`)) return generationStart;
        if (p.includes('/generations/')) return generationView;
        return generationSong;
    };
    const mount = async () => { await act(async () => root.render(<Screen />)); };
    const posts = () => mockApi.request.mock.calls.filter(([p]) => p.endsWith(`/${kind}s`));
    beforeEach(async () => {
        RN.AppState.currentState = 'active'; resetCacheUser(); resetNetworkState(); await bindCacheUser('generation-screen-user');
        jest.clearAllMocks(); mockApi.request.mockImplementation(baseResponse); jest.useFakeTimers();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
    });
    afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); jest.useRealTimers(); resetNetworkState(); });
    test('prompt, rights and exact two-output price precede spend; edits invalidate quote', async () => {
        await mount(); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
        expect(field().props).toMatchObject({ multiline: true, maxLength: MUSIC_COVER_PROMPT_MAX });
        await review(); expect(posts()).toHaveLength(0);
        expect(text(t('musicGenerationActions.duration', { seconds: quote.source_duration_seconds })).length).toBeGreaterThan(0);
        expect(text(t('musicGenerationActions.charge')).length).toBeGreaterThan(0);
        expect(text(t('musicActions.action.balance', { balance: 100, after: 90 })).length).toBeGreaterThan(0);
        expect(text(kind === 'extend' ? t('musicGenerationActions.extend.pair', { seconds: 30, total: 10, each: 5 })
            : t('musicGenerationActions.cover.pair', { total: 10, each: 5 })).length).toBeGreaterThan(0);
        await edit('new sound'); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        await click(t('musicActions.action.review')); await rights(); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        await rights(); await edit('   '); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    });
    if (kind === 'cover') test('influence defaults to 50, has accessible 44pt steps, clamps to 10..90 and invalidates quote', async () => {
        await mount(); expect(text(t('musicGenerationActions.influence', { value: 50 })).length).toBeGreaterThan(0);
        for (const name of ['less', 'more']) expect(RN.StyleSheet.flatten(button(t(`musicGenerationActions.${name}`)).props.style).minHeight).toBeGreaterThanOrEqual(44);
        await review(); await click(t('musicGenerationActions.more')); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        for (let i = 55; i > 10; i -= 5) await click(t('musicGenerationActions.less'));
        expect(button(t('musicGenerationActions.less')).props.accessibilityState.disabled).toBe(true);
        expect(text(t('musicGenerationActions.influence', { value: 10 })).length).toBeGreaterThan(0);
        for (let i = 10; i < 90; i += 5) await click(t('musicGenerationActions.more'));
        expect(button(t('musicGenerationActions.more')).props.accessibilityState.disabled).toBe(true);
        await click(t('musicActions.action.review'));
        expect(JSON.parse(mockApi.request.mock.calls.findLast(([p]) => p.endsWith('/cover-quotes'))![1].body).source_influence).toBe(90);
    });
    test.each([undefined, null, 76])('503 then expired replay balance %p never shows quote balance or NaN', async balance_after => {
        let sends = 0;
        mockApi.request.mockImplementation((p: string, init?: RequestInit) => {
            if (p.endsWith(`/${kind}-quotes`)) return { ...quote, expires_at: new Date(Date.now() + 1000).toISOString() };
            if (p.endsWith(`/${kind}s`)) { if (++sends === 1) throw new ApiError(503, 'pair_acceptance_unknown'); return { ...generationReplay, balance_after }; }
            return baseResponse(p, init);
        });
        await mount(); await review(); await confirm(); await tick();
        expect(field().props.editable).toBe(false); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
        await click(t('musicActions.action.recover', { credits: 10 }));
        expect(posts()).toHaveLength(2); expect(posts()[0][1].body).toBe(posts()[1][1].body);
        expect(text(t('musicActions.action.remaining', { balance: 90 }))).toHaveLength(0);
        expect(text(t('musicActions.action.balance', { balance: 100, after: 90 }))).toHaveLength(0);
        expect(text(t('musicActions.action.remaining', { balance: 76 })).length).toBe(balance_after === 76 ? 1 : 0);
        expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes('NaN')))).toHaveLength(0);
    });
    test('A and B sharing one song each start their own job through MusicPlayer; open song says current version', async () => {
        mockApi.request.mockImplementation((p, init) => p.includes('/generations/') ? readyView : baseResponse(p, init));
        await mount(); await review(); await confirm(); await tick();
        for (const candidate of readyView.candidates) {
            await click(t('music.playNamed', { title: candidate.label }));
            expect(mockPlay).toHaveBeenLastCalledWith({ songId: SONG_ID, jobId: candidate.job_id, start: 0 });
        }
        expect(mockPlay.mock.calls.map(([input]) => input.jobId)).toEqual(readyView.candidates.map(c => c.job_id));
        await click(t('musicGenerationActions.openSong')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/[id]', params: { id: SONG_ID } });
        const candidate = { ...readyView.candidates[0], song_id: `${SONG_ID}\n` };
        await act(async () => root.render(<MusicCandidateCard candidate={candidate} requireValidSongId onPlay={jest.fn()} />));
        expect(button(t('music.create.openSong'))).toBeUndefined();
        expect(candidatePlayback({ ...candidate, audio_url: `/api/v1/jobs/${readyView.candidates[1].job_id}/asset` })).toBeNull();
    });
    test.each(['queued', 'running', 'ready', 'failed', 'refunded'])('candidate %s uses its own state copy', async state => {
        mockApi.request.mockImplementation((p, init) => p.includes('/generations/') ? { ...readyView, state: 'partial', candidates: readyView.candidates.map(c => ({ ...c, state })) } : baseResponse(p, init));
        await mount(); await review(); await confirm(); await tick(); expect(text(t(`music.create.${state}`))).toHaveLength(2);
    });
    test.each(['source_duration_unavailable', 'source_duration_invalid'])('%s shows shared duration limit with no spend', async code => {
        mockApi.request.mockImplementation((p, init) => { if (p.endsWith(`/${kind}-quotes`)) throw new ApiError(400, code); return baseResponse(p, init); });
        await mount(); await review(); expect(posts()).toHaveLength(0);
        expect(text(t(`musicGenerationActions.${kind}.limit`, { minutes: (kind === 'extend' ? MUSIC_EXTEND_DURATION_MAX : MUSIC_COVER_DURATION_MAX) / 60 })).length).toBeGreaterThan(0);
    });
    test('source_changed is definitive and has no recovery control', async () => {
        await mount(); await review(); mockApi.request.mockRejectedValueOnce(new ApiError(409, 'source_changed')); await confirm();
        expect(button(t('musicActions.action.recover', { credits: 10 }))).toBeUndefined();
        expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        expect(text(t('musicActions.action.changed')).length).toBeGreaterThan(0);
    });
    test('off response hides feature and entries require advertised action on active song', async () => {
        await mount(); mockApi.request.mockImplementation((p, init) => { if (p.endsWith(`/${kind}-quotes`)) throw new ApiError(404, `music_${kind}_unavailable`); return baseResponse(p, init); });
        await review(); expect(text(t('music.off')).length).toBeGreaterThan(0); expect(button(t('musicActions.action.review'))).toBeUndefined();
        await act(async () => root.render(<MusicSongActions song={generationSong} />)); await click(t(`musicGenerationActions.${kind}.title`));
        expect(mockPush).toHaveBeenCalledWith({ pathname: `/music/${kind}`, params: { id: SONG_ID } });
        for (const patch of [{ actions: [] }, { lifecycle_status: 'trashed' }]) {
            await act(async () => root.render(<MusicSongActions song={{ ...generationSong, ...patch }} />)); expect(button(t(`musicGenerationActions.${kind}.title`))).toBeUndefined();
        }
    });
    test('StrictMode loads a fresh flow; five-minute ceiling offers refresh; account change removes results', async () => {
        await act(async () => root.render(<StrictMode><Screen /></StrictMode>)); await review(); await confirm(); await tick(300000);
        expect(text(t('musicActions.action.waiting')).length).toBeGreaterThan(0); const count = mockApi.request.mock.calls.length;
        await click(t('musicActions.action.refresh')); expect(mockApi.request).toHaveBeenCalledTimes(count + 1);
        await act(async () => bindCacheUser('other-screen-user')); expect(button(t('musicActions.action.refresh'))).toBeUndefined();
        expect(mockPlay).not.toHaveBeenCalled();
    });
});
