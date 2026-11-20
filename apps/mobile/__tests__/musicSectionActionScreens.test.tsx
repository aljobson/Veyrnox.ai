import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Extend from '../src/app/(app)/music/add-section';
import Cover from '../src/app/(app)/music/replace-section';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { MusicCandidateCard, candidatePlayback } from '../src/components/music/MusicCandidateCard';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { MUSIC_COVER_PROMPT_MAX, MUSIC_STYLES_MAX, MUSIC_REPLACE_DURATION_MAX, MUSIC_ADD_SECTION_SOURCE_MAX } from '../src/lib/music/shared';
import { t } from '../src/lib/i18n';
import { SONG_ID } from './fixtures/musicActions';
import { sectionSong as generationSong, addSectionQuote as extendQuote, replaceQuote as coverQuote, generationStart, generationReplay, generationView, readyView } from './fixtures/musicSectionActions';
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
const field = () => root.container.queryAll(n => [t('musicGenerationActions.prompt'), t('musicSectionActions.styles')].includes(n.props.accessibilityLabel) && typeof n.props.onChangeText === 'function')[0];
const edit = async (value: string) => { await act(async () => field().props.onChangeText(value)); };
const rights = async () => { await act(async () => controls('checkbox')[0].props.onClick({ nativeEvent: {} })); };
const review = async () => { await edit('  warm piano  '); await rights(); await click(t('musicActions.action.review')); };
const confirm = () => click(t('musicActions.action.confirm', { credits: 10 }));
const tick = async (ms = 1500) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
for (const kind of ['add_section', 'replace_section'] as const) describe(kind, () => {
    const Screen = kind === 'add_section' ? Extend : Cover, quote = kind === 'add_section' ? extendQuote : coverQuote;
    const route = kind === 'add_section' ? 'sections' : 'replacements', quoteRoute = kind === 'add_section' ? 'add-section-quotes' : 'replace-quotes';
    const baseResponse = async (p: string, init?: RequestInit): Promise<unknown> => {
        if (p.endsWith(`/${quoteRoute}`)) return { ...quote, ...(kind === 'add_section' ? { position: JSON.parse(String(init?.body)).position, duration_seconds: JSON.parse(String(init?.body)).duration_seconds, instrumental: !JSON.parse(String(init?.body)).lyrics } : { start_seconds: JSON.parse(String(init?.body)).start_seconds, end_seconds: JSON.parse(String(init?.body)).end_seconds }) };
        if (p.endsWith(`/${route}`)) return generationStart;
        if (p.includes('/generations/')) return generationView;
        return generationSong;
    };
    const mount = async () => { await act(async () => root.render(<Screen />)); };
    const posts = () => mockApi.request.mock.calls.filter(([p]) => p.endsWith(`/${route}`));
    beforeEach(async () => {
        RN.AppState.currentState = 'active'; resetCacheUser(); resetNetworkState(); await bindCacheUser('generation-screen-user');
        jest.clearAllMocks(); mockApi.request.mockImplementation(baseResponse); jest.useFakeTimers();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
    });
    afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); jest.useRealTimers(); resetNetworkState(); });
    test('prompt, rights and exact two-output price precede spend; edits invalidate quote', async () => {
        await mount(); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
        expect(field().props).toMatchObject({ multiline: true, maxLength: kind === 'add_section' ? MUSIC_STYLES_MAX : MUSIC_COVER_PROMPT_MAX });
        await review(); expect(posts()).toHaveLength(0);
        expect(text(t('musicGenerationActions.duration', { seconds: quote.source_duration_seconds })).length).toBeGreaterThan(0);
        expect(text(t('musicGenerationActions.charge')).length).toBeGreaterThan(0);
        expect(text(t('musicActions.action.balance', { balance: 100, after: 90 })).length).toBeGreaterThan(0);
        expect(text(t('musicSectionActions.pair', { total: 10, each: 5 })).length).toBeGreaterThan(0);
        await edit('new sound'); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        await click(t('musicActions.action.review')); await rights(); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        await rights(); await edit('   '); expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
    });
    test.each([undefined, null, 76])('503 then expired replay balance %p never shows quote balance or NaN', async balance_after => {
        let sends = 0;
        mockApi.request.mockImplementation((p: string, init?: RequestInit) => {
            if (p.endsWith(`/${quoteRoute}`)) return { ...quote, expires_at: new Date(Date.now() + 1000).toISOString() };
            if (p.endsWith(`/${route}`)) { if (++sends === 1) throw new ApiError(503, 'pair_acceptance_unknown'); return { ...generationReplay, balance_after }; }
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
        mockApi.request.mockImplementation((p, init) => { if (p.endsWith(`/${quoteRoute}`)) throw new ApiError(400, code); return baseResponse(p, init); });
        await mount(); await review(); expect(posts()).toHaveLength(0);
        expect(text(t('musicSectionActions.sourceLimit', { seconds: kind === 'add_section' ? MUSIC_ADD_SECTION_SOURCE_MAX : MUSIC_REPLACE_DURATION_MAX })).length).toBeGreaterThan(0);
    });
    test('source_changed is definitive and has no recovery control', async () => {
        await mount(); await review(); mockApi.request.mockRejectedValueOnce(new ApiError(409, 'source_changed')); await confirm();
        expect(button(t('musicActions.action.recover', { credits: 10 }))).toBeUndefined();
        expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        expect(text(t('musicActions.action.changed')).length).toBeGreaterThan(0);
    });
    test('off response hides feature and entries require advertised action on active song', async () => {
        await mount(); mockApi.request.mockImplementation((p, init) => { if (p.endsWith(`/${quoteRoute}`)) throw new ApiError(404, kind === 'add_section' ? 'music_add_section_unavailable' : 'music_replace_unavailable'); return baseResponse(p, init); });
        await review(); expect(text(t('music.off')).length).toBeGreaterThan(0); expect(button(t('musicActions.action.review'))).toBeUndefined();
        await act(async () => root.render(<MusicSongActions song={generationSong} />)); await click(t(`musicSectionActions.${kind}.title`));
        expect(mockPush).toHaveBeenCalledWith({ pathname: kind === 'add_section' ? '/music/add-section' : '/music/replace-section', params: { id: SONG_ID } });
        for (const patch of [{ actions: [] }, { lifecycle_status: 'trashed' }]) {
            await act(async () => root.render(<MusicSongActions song={{ ...generationSong, ...patch }} />)); expect(button(t(`musicSectionActions.${kind}.title`))).toBeUndefined();
        }
    });
    test('StrictMode loads a fresh flow; five-minute ceiling offers refresh; account change removes results', async () => {
        await act(async () => root.render(<StrictMode><Screen /></StrictMode>)); await review(); await confirm(); await tick(300000);
        expect(text(t('musicActions.action.waiting')).length).toBeGreaterThan(0); const count = mockApi.request.mock.calls.length;
        await click(t('musicActions.action.refresh')); expect(mockApi.request).toHaveBeenCalledTimes(count + 1);
        await act(async () => bindCacheUser('other-screen-user')); expect(button(t('musicActions.action.refresh'))).toBeUndefined();
        expect(mockPlay).not.toHaveBeenCalled();
    });
    if (kind === 'add_section') test('accessible single-choice groups and every field edit invalidate the quote', async () => {
        await mount(); await review();
        const radios = controls('radio'); expect(radios).toHaveLength(5);
        const select = async (label: string) => act(async () => controls('radio', label)[0].props.onClick({ nativeEvent: {} }));
        for (const label of [t('musicSectionActions.position.beginning'), t('musicSectionActions.duration.20')]) {
            await select(label); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
            expect(controls('radio', label)[0].props.accessibilityState.checked).toBe(true); await click(t('musicActions.action.review'));
        }
        const lyrics = root.container.queryAll(n => n.props.accessibilityLabel === t('musicSectionActions.lyrics') && typeof n.props.onChangeText === 'function')[0];
        expect(lyrics.props).toMatchObject({ multiline: true, maxLength: 3000 });
        await act(async () => lyrics.props.onChangeText('  sing  ')); expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
        await click(t('musicActions.action.review')); expect(text(t('musicSectionActions.withLyrics')).length).toBeGreaterThan(0);
        expect(text(t('musicSectionActions.position.beginning')).length).toBeGreaterThan(0);
    });
    if (kind === 'replace_section') {
        test('half-second steppers are 44pt, show exact range, invalidate quote and validate live', async () => {
            await mount(); await review();
            for (const key of ['startLess', 'startMore', 'endLess', 'endMore'])
                expect(RN.StyleSheet.flatten(button(t(`musicSectionActions.${key}`)).props.style).minHeight).toBeGreaterThanOrEqual(44);
            await click(t('musicSectionActions.startMore'));
            expect(text(t('musicSectionActions.start', { seconds: 0.5 })).length).toBeGreaterThan(0);
            expect(button(t('musicActions.action.confirm', { credits: 10 }))).toBeUndefined();
            expect(button(t('musicActions.action.review')).props.accessibilityState.disabled).toBe(true);
            await click(t('musicSectionActions.endMore')); await click(t('musicActions.action.review'));
            expect(text(t('musicSectionActions.range', { start: 0.5, end: 1.5 })).length).toBeGreaterThan(0);
            const body = JSON.parse(mockApi.request.mock.calls.findLast(([p]) => p.endsWith('/replace-quotes'))![1].body);
            expect(body).toMatchObject({ start_seconds: 0.5, end_seconds: 1.5 });
        });
        test('server duration travels through the real flow to the message and clears on edit', async () => {
            mockApi.request.mockImplementation((p, init) => {
                if (p.endsWith('/replace-quotes')) throw new ApiError(400, 'range_invalid', { source_duration_seconds: 8.75, lyrics: 'must not render' });
                return baseResponse(p, init);
            });
            await mount(); await review();
            const message = t('musicSectionActions.rangeMeasured', { seconds: 8.75, max: 30, limit: 60 });
            expect(text(message).length).toBeGreaterThan(0); expect(posts()).toHaveLength(0);
            await click(t('musicSectionActions.endMore')); expect(text(message)).toHaveLength(0);
        });
        test.each(['take_commit_conflict', 'revision_conflict', 'take_commit_unknown', 'not_found', 'success'])('commit %s is explicit and leaves auditioning usable', async outcome => {
            let commits = 0;
            mockApi.request.mockImplementation((p, init) => {
                if (p.endsWith('/replacements/commit')) {
                    commits++; if (outcome !== 'success' && commits === 1) throw new ApiError(outcome === 'take_commit_unknown' ? 503 : outcome === 'not_found' ? 404 : 409, outcome);
                    return { version_id: readyView.candidates[0].version_id, idempotent: commits > 1 };
                }
                return p.includes('/generations/') ? readyView : baseResponse(p, init);
            });
            await mount(); await review(); await confirm(); await tick(); expect(commits).toBe(0);
            expect(text(t('musicSectionActions.keepBeforeLeaving'))).toHaveLength(1);
            await click(t('musicSectionActions.keep', { label: 'A' })); expect(commits).toBe(1);
            if (outcome === 'take_commit_unknown') {
                expect(text(t('musicSectionActions.commitUnknown')).length).toBeGreaterThan(0);
                await click(t('musicSectionActions.retryKeep', { label: 'A' }));
                const calls = mockApi.request.mock.calls.filter(([p]) => p.endsWith('/replacements/commit'));
                expect(calls[0][1].body).toBe(calls[1][1].body);
            } else if (outcome === 'revision_conflict') {
                expect(text(t('musicActions.action.changed'))).toHaveLength(1);
                await click(t('musicGenerationActions.openSong')); expect(mockPush).toHaveBeenCalled();
            } else if (outcome === 'take_commit_conflict') expect(text(t('musicSectionActions.commitConflict'))).toHaveLength(1);
            else if (outcome === 'not_found') {
                expect(text(t('musicSectionActions.commitMissing'))).toHaveLength(1);
                expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/replacements/commit'))).toHaveLength(1);
            }
            else expect(text(t('musicSectionActions.committed', { label: 'A' })).length).toBeGreaterThan(0);
            for (const c of readyView.candidates) {
                expect(button(t('musicSectionActions.keep', { label: c.label })).props.accessibilityState.disabled).toBe(true);
                await click(t('music.playNamed', { title: c.label })); expect(mockPlay).toHaveBeenLastCalledWith({ songId: SONG_ID, jobId: c.job_id, start: 0 });
            }
        });
    }

});
