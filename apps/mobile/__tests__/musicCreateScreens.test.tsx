import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import MusicCreate from '../src/app/(app)/music/create';
import { MusicQueue } from '../src/components/music/MusicQueue';
import { MusicCandidateCard, candidatePlayback } from '../src/components/music/MusicCandidateCard';
import { MusicLyricsPanel, insertLyricsLabel } from '../src/components/music/MusicLyricsPanel';
import { ApiError, type ApiClient } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { getMusicCreateSession } from '../src/lib/music/createSession';
import { t } from '../src/lib/i18n';
import { bindMusicLyricThread, MUSIC_LYRIC_BEGIN, MUSIC_LYRIC_END, selectMusicLyricPersona, stageMusicLyricHandoff, stageMusicLyricProposal } from '../src/lib/music/lyricAssistantHandoff';
import { entitlements, draft, quote, generation, view, custom, crunEntitlements, crunDraft } from './fixtures/musicCreate';
import { JOB } from './fixtures/music';
const mockApi = { request: jest.fn() }, mockPush = jest.fn(), mockSetParams = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
    useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: () => require('react').createElement(require('react-native').View, { testID: 'music-player' }) }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const button = (value: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === value)[0];
const click = async (value: string) => { await act(async () => button(value).props.onClick({ nativeEvent: {} })); };
const field = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
const edit = async (key: string, value: string) => { await act(async () => field(t(`music.create.${key}`)).props.onChangeText(value)); };
const mount = async () => { await act(async () => root.render(<MusicCreate />)); };
const remount = async () => { await act(async () => root.unmount()); root = createRoot(); await mount(); };
const mode = async (value: string) => {
    const label = value === 'simple' ? 'music.create.describe' : 'music.create.lyrics';
    const tab = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === t(label))[0];
    await act(async () => tab.props.onClick({ nativeEvent: {} }));
};
const customVocal = async () => {
    await mode('custom');
    const flow = getMusicCreateSession(mockApi as unknown as ApiClient);
    await act(async () => { await flow.loadDraft(); flow.edit({ instrumental: false }); });
};
const baseResponse = async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path.endsWith('/entitlements')) return entitlements;
    if (path.endsWith('/drafts/custom')) return { draft: init ? { ...draft, ...JSON.parse(init.body as string), revision: 1 } : draft };
    if (path.endsWith('/generation-quotes')) return JSON.parse(init!.body as string).mode === 'custom' ? { ...quote, mode: 'custom', model_id: custom.model_id } : quote;
    if (path.endsWith('/generations')) return generation;
    return view;
};
beforeEach(async () => {
    RN.AppState.currentState = 'active';
    resetCacheUser(); await bindCacheUser('music-create-user'); jest.clearAllMocks(); mockParams = {}; mockApi.request.mockImplementation(baseResponse);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); jest.useRealTimers(); });
const longEntitlements = { ...entitlements, models: entitlements.models.map(model => ({ ...model, controls: {
    ...model.controls, duration_seconds: { ...model.controls.duration_seconds, max: 135, default: 135 }, duration_price_block_seconds: 60,
} })) };
test.each([undefined, 30, 60])('duration price hint is shown only for a 60-second block, received %p', async block => {
    const response = { ...entitlements, models: entitlements.models.map(model => ({ ...model,
        controls: { ...model.controls, ...(block === undefined ? {} : { duration_price_block_seconds: block }) },
    })) };
    mockApi.request.mockImplementation((path, init) => path.endsWith('/entitlements') ? response : baseResponse(path, init));
    await mount();
    const hint = t('music.create.durationPriceHint');
    if (block === 60) {
        expect(text(hint).length).toBeGreaterThan(0);
        expect(hint).toContain('60-second steps');
        expect(hint.replace('60-second', '')).not.toMatch(/\d/);
        expect(hint).not.toMatch(/\d+\s*credits?|credits?\s*[:=]?\s*\d+/i);
    } else expect(text(hint)).toHaveLength(0);
});
test.each(['foreground', 'focus'])('%s refreshes entitlements for an already-loaded session without losing the form', async trigger => {
    let appStateChanged!: (state: RN.AppStateStatus) => void;
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_event, callback) => {
        appStateChanged = callback; return { remove: jest.fn() };
    });
    mockApi.request.mockImplementation((path, init) => path.endsWith('/entitlements') ? longEntitlements : baseResponse(path, init));
    await mount(); await edit('prompt', 'Quiet piano'); await edit('songTitle', 'Evening');
    const flow = getMusicCreateSession(mockApi as unknown as ApiClient), refresh = jest.spyOn(flow, 'refreshEntitlements');
    expect(flow.snapshot().status).toBe('on');
    expect(text(t('music.create.duration', { seconds: 135 })).length).toBeGreaterThan(0);
    mockApi.request.mockClear(); mockApi.request.mockImplementation(baseResponse);
    if (trigger === 'foreground') {
        await act(async () => appStateChanged('active'));
        await act(async () => appStateChanged('background'));
        expect(refresh).not.toHaveBeenCalled(); expect(mockApi.request).not.toHaveBeenCalled();
        await act(async () => appStateChanged('active'));
    } else await remount();
    expect(getMusicCreateSession(mockApi as unknown as ApiClient)).toBe(flow);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mockApi.request.mock.calls).toEqual([['/api/v1/music/entitlements']]);
    expect(field(t('music.create.prompt')).props.value).toBe('Quiet piano');
    expect(field(t('music.create.songTitle')).props.value).toBe('Evening');
    expect(text(t('music.create.duration', { seconds: 60 })).length).toBeGreaterThan(0);
    expect(text(t('music.create.durationPriceHint'))).toHaveLength(0);
});
test('a deferred submit cannot restore the old duration maximum or hint after a refresh', async () => {
    let finish!: (value: typeof generation) => void;
    const submitted = new Promise<typeof generation>(resolve => { finish = resolve; });
    mockApi.request.mockImplementation((path, init) => path.endsWith('/entitlements') ? longEntitlements
        : path.endsWith('/generations') ? submitted : baseResponse(path, init));
    await mount(); await edit('prompt', 'Quiet piano'); await click(t('music.create.review'));
    expect(text(t('music.create.durationPriceHint')).length).toBeGreaterThan(0);
    const flow = getMusicCreateSession(mockApi as unknown as ApiClient);
    let confirming!: Promise<void>;
    await act(async () => { confirming = flow.confirm(); });
    expect(flow.snapshot().busy).toBe(true);
    expect(flow.attempts.snapshot()?.input.duration).toBe(135);
    mockApi.request.mockImplementation(baseResponse);
    await act(async () => { await flow.refreshEntitlements(); });
    expect(text(t('music.create.duration', { seconds: 60 })).length).toBeGreaterThan(0);
    expect(button(t('music.create.longer')).props.accessibilityState.disabled).toBe(true);
    expect(text(t('music.create.durationPriceHint'))).toHaveLength(0);
    expect(flow.attempts.snapshot()?.input.duration).toBe(135);
    const refreshed = flow.snapshot().entitlements;
    await act(async () => { finish(generation); await confirming; });
    expect(flow.snapshot().entitlements).toEqual({ ...refreshed, balance: generation.balance_after });
    expect(text(t('music.create.duration', { seconds: 60 })).length).toBeGreaterThan(0);
    expect(button(t('music.create.longer')).props.accessibilityState.disabled).toBe(true);
    expect(text(t('music.create.durationPriceHint'))).toHaveLength(0);
    expect(field(t('music.create.prompt')).props.value).toBe('Quiet piano');
});
test.each([new ApiError(404, 'music_unavailable'), { ...entitlements, available: false }])('off does not request drafts or quotes: %p', async response => {
    mockApi.request.mockImplementation(async () => { if (response instanceof Error) throw response; return response; });
    await mount(); expect(text(t('music.off')).length).toBeGreaterThan(0); expect(mockApi.request).toHaveBeenCalledTimes(1);
    await remount(); expect(mockApi.request).toHaveBeenCalledTimes(1);
});
test('price and balance after appear before confirm and only confirm spends', async () => {
    await mount(); expect(button(t('music.create.confirm', { credits: 10 }))).toBeUndefined();
    await edit('prompt', 'Quiet piano'); await click(t('music.create.review'));
    expect(text(t('music.create.balance', { balance: 100, after: 90 })).length).toBeGreaterThan(0);
    expect(text(t('music.create.price', { each: 5, count: 2, total: 10 })).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.some(([p]) => p.endsWith('/generations'))).toBe(false);
    await click(t('music.create.confirm', { credits: 10 })); expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/generations'))).toHaveLength(1);
});
test('insufficient balance disables confirm without purchase controls', async () => {
    mockApi.request.mockImplementation((path, init) => path.endsWith('/generation-quotes') ? { ...quote, affordable: false, balance_after: -10 } : baseResponse(path, init));
    await mount(); await edit('prompt', 'Piano'); await click(t('music.create.review'));
    expect(button(t('music.create.confirm', { credits: 10 })).props.accessibilityState.disabled).toBe(true);
    expect(text(t('music.create.not_affordable')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => /purchase|buy|upgrade/i.test(n.props.accessibilityLabel ?? ''))).toHaveLength(0);
});
test('locked model is visible, disabled and cannot submit', async () => {
    mockApi.request.mockImplementation((path, init) => path.endsWith('/entitlements') ? { ...entitlements, models: entitlements.models.map(m => ({ ...m, available: false })) } : baseResponse(path, init));
    await mount(); const locked = button(t('music.create.paidModel', { model: 'ACE-Step 1.5' }));
    expect(locked.props.accessibilityState.disabled).toBe(true);
    await act(async () => locked.props.onClick({ nativeEvent: {} })); await edit('prompt', 'Piano');
    await click(t('music.create.review')); expect(mockApi.request.mock.calls.filter(([p]) => /generation/.test(p))).toHaveLength(0);
});
test('advanced controls are capability-gated progressive disclosure and never render in Custom', async () => {
    await mount();
    expect(button(t('music.create.advanced.show'))).toBeUndefined();
    await click('ACE-Step 1.5');
    const disclosure = button(t('music.create.advanced.show'));
    expect(disclosure.props.accessibilityState.expanded).toBe(false);
    await click(t('music.create.advanced.show'));
    const variety = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable'
        && n.props.accessibilityLabel === t('music.create.advanced.variety'))[0];
    await act(async () => variety.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(getMusicCreateSession(mockApi as unknown as ApiClient).snapshot().input.variety).toBe(51);
    expect(field(t('music.create.advanced.excludeStyles'))).toBeDefined();
    const bpm = field(t('music.create.advanced.bpm'));
    await act(async () => bpm.props.onChangeText('221'));
    expect(text(t('music.create.advanced.bpmInvalid', { min: 40, max: 220 })).length).toBeGreaterThan(0);
    expect(button(t('music.create.review')).props.accessibilityState.disabled).toBe(true);
    await click(t('music.create.advanced.hide'));
    expect(field(t('music.create.advanced.bpm'))).toBeUndefined();
    expect(text(t('music.create.advanced.bpmInvalid', { min: 40, max: 220 })).length).toBeGreaterThan(0);
    await mode('custom');
    expect(button(t('music.create.advanced.hide'))).toBeUndefined();
    expect(field(t('music.create.advanced.excludeStyles'))).toBeUndefined();
    expect(field(t('music.create.advanced.bpm'))).toBeUndefined();
    await mode('simple');
    expect(button(t('music.create.advanced.hide')).props.accessibilityState.expanded).toBe(true);
    expect(text(t('music.create.advanced.bpmInvalid', { min: 40, max: 220 })).length).toBeGreaterThan(0);
});
test('Lyricist profiles render only for Custom vocals', async () => {
    await mount();
    expect(text(t('musicLyricist.title'))).toHaveLength(0);
    await mode('custom');
    expect(text(t('musicLyricist.title'))).toHaveLength(0);
    const instrumental = root.container.queryAll(n => n.props.accessibilityLabel === t('music.create.instrumental')
        && typeof n.props.onChange === 'function')[0];
    await act(async () => instrumental.props.onChange({ nativeEvent: { value: false } }));
    expect(text(t('musicLyricist.title')).length).toBeGreaterThan(0);
    await act(async () => instrumental.props.onChange({ nativeEvent: { value: true } }));
    expect(text(t('musicLyricist.title'))).toHaveLength(0);
    await mode('simple');
    expect(text(t('musicLyricist.title'))).toHaveLength(0);
});
test('custom saves draft then quotes saved revision and resolves conflict', async () => {
    await mount(); await mode('custom'); await edit('lyrics', 'My lyrics'); await edit('styles', 'warm piano');
    let conflicted = false;
    mockApi.request.mockImplementation((path, init) => {
        if (init?.method === 'PUT' && !conflicted) { conflicted = true; throw new ApiError(409, 'revision_conflict', { draft: { ...draft, revision: 9, lyrics: 'server lyrics' } }); }
        return baseResponse(path, init);
    });
    await click(t('music.create.review')); expect(text('server lyrics').length).toBeGreaterThan(0);
    await click(t('music.create.keepMine'));
    const puts = mockApi.request.mock.calls.filter(([, init]) => init?.method === 'PUT'); expect(JSON.parse(puts[1][1].body)).toMatchObject({ revision: 9, lyrics: 'My lyrics' });
    const body = JSON.parse(mockApi.request.mock.calls.find(([p]) => p.endsWith('/generation-quotes'))![1].body);
    expect(body.draft_revision).toBe(1);
});
test('custom vocal creation stages only an opaque Lyricist handoff and does not quote', async () => {
    await mount(); await customVocal();
    expect(field(t('music.lyricAssistant.request'))).toBeDefined();
    await act(async () => field(t('music.lyricAssistant.request')).props.onChangeText('Make the chorus more vivid.'));
    mockApi.request.mockClear();
    await click(t('music.lyricAssistant.work'));
    const route = mockPush.mock.calls.at(-1)?.[0];
    expect(route.pathname).toBe('/chat/new');
    expect(route.params.lyricHandoff).toMatch(/^lyrics-/);
    expect(JSON.stringify(route)).not.toContain('chorus');
    expect(mockApi.request.mock.calls.some(([path]) => String(path).includes('generation'))).toBe(false);
});
test('the Lyricist section is also available for the Suno custom-vocal contract', async () => {
    mockApi.request.mockImplementation((path, init) => path.endsWith('/entitlements') ? crunEntitlements
        : path.endsWith('/drafts/custom') && !init ? { draft: crunDraft } : baseResponse(path, init));
    await mount(); await customVocal();
    expect(field(t('music.lyricAssistant.request'))).toBeDefined();
});
test('returned Lyricist proposal requires review, resets rights, and never quotes on Apply', async () => {
    await mount(); await customVocal(); await edit('lyrics', 'Old words'); await edit('styles', 'warm piano');
    const rights = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0];
    await act(async () => rights.props.onClick({ nativeEvent: {} }));
    const flow = getMusicCreateSession(mockApi as unknown as ApiClient), current = flow.snapshot();
    expect(current.rights).toBe(true);
    const token = stageMusicLyricHandoff({ sourceLyrics: current.input.lyrics, lyricLimit: 3000, request: 'Rewrite it.',
        draftId: current.draft!.id, draftRevision: current.draft!.revision })!;
    selectMusicLyricPersona(token, 'persona-one'); bindMusicLyricThread(token, 'persona-one', 'thread-one');
    stageMusicLyricProposal(token, 'thread-one', 'assistant-one', `${MUSIC_LYRIC_BEGIN}\nNew words\n${MUSIC_LYRIC_END}`);
    mockApi.request.mockClear(); mockParams = { lyricHandoff: token };
    await act(async () => root.render(<MusicCreate />));
    expect(button(t('music.lyricAssistant.apply'))).toBeDefined();
    expect(flow.snapshot().input.lyrics).toBe('Old words');
    await click(t('music.lyricAssistant.apply'));
    expect(flow.snapshot().input.lyrics).toBe('New words');
    expect(flow.snapshot().rights).toBe(false);
    expect(mockSetParams).toHaveBeenCalledWith({ lyricHandoff: undefined });
    expect(mockApi.request.mock.calls.some(([path]) => String(path).includes('generation'))).toBe(false);
});
test('a stale returned proposal is rejected and a reviewed proposal can be discarded idempotently', async () => {
    await mount(); await customVocal(); await edit('lyrics', 'Source words'); await edit('styles', 'piano');
    const flow = getMusicCreateSession(mockApi as unknown as ApiClient), current = flow.snapshot();
    const stale = stageMusicLyricHandoff({ sourceLyrics: current.input.lyrics, lyricLimit: 3000, request: 'Rewrite.',
        draftId: current.draft!.id, draftRevision: current.draft!.revision })!;
    selectMusicLyricPersona(stale, 'p'); bindMusicLyricThread(stale, 'p', 't');
    stageMusicLyricProposal(stale, 't', 'a', `${MUSIC_LYRIC_BEGIN}\nProposal\n${MUSIC_LYRIC_END}`);
    await edit('lyrics', 'Locally changed'); mockParams = { lyricHandoff: stale };
    await act(async () => root.render(<MusicCreate />));
    expect(button(t('music.lyricAssistant.apply'))).toBeUndefined();
    expect(text(t('music.lyricAssistant.stale')).length).toBeGreaterThan(0);

    const freshState = flow.snapshot();
    const fresh = stageMusicLyricHandoff({ sourceLyrics: freshState.input.lyrics, lyricLimit: 3000, request: 'Rewrite.',
        draftId: freshState.draft!.id, draftRevision: freshState.draft!.revision })!;
    selectMusicLyricPersona(fresh, 'p'); bindMusicLyricThread(fresh, 'p', 't2');
    stageMusicLyricProposal(fresh, 't2', 'a2', `${MUSIC_LYRIC_BEGIN}\nDiscard me\n${MUSIC_LYRIC_END}`);
    mockParams = { lyricHandoff: fresh }; await act(async () => root.render(<MusicCreate />));
    await click(t('music.lyricAssistant.discard'));
    expect(flow.snapshot().input.lyrics).toBe('Locally changed');
    await act(async () => root.render(<MusicCreate />));
    expect(button(t('music.lyricAssistant.apply'))).toBeUndefined();
});
test('a returned proposal is withdrawn if the active lyric limit shrinks before Apply', async () => {
    await mount(); await customVocal(); await edit('lyrics', 'Source'); await edit('styles', 'piano');
    const flow = getMusicCreateSession(mockApi as unknown as ApiClient), current = flow.snapshot();
    const token = stageMusicLyricHandoff({ sourceLyrics: current.input.lyrics, lyricLimit: 3000, request: 'Rewrite.',
        draftId: current.draft!.id, draftRevision: current.draft!.revision })!;
    selectMusicLyricPersona(token, 'p'); bindMusicLyricThread(token, 'p', 't');
    stageMusicLyricProposal(token, 't', 'a', `${MUSIC_LYRIC_BEGIN}\nLong proposal\n${MUSIC_LYRIC_END}`);
    mockParams = { lyricHandoff: token }; await act(async () => root.render(<MusicCreate />));
    expect(button(t('music.lyricAssistant.apply'))).toBeDefined();
    const smaller = { ...entitlements, custom_drafts: { ...entitlements.custom_drafts, lyrics_max: 3 } };
    mockApi.request.mockImplementation((path, init) => path.endsWith('/entitlements') ? smaller : baseResponse(path, init));
    await act(async () => { await flow.refreshEntitlements(); });
    expect(button(t('music.lyricAssistant.apply'))).toBeUndefined();
    expect(text(t('music.lyricAssistant.overLength')).length).toBeGreaterThan(0);
});
test('lost acknowledgement survives expiry and remount with same key and snapshot lyrics', async () => {
    jest.useFakeTimers(); let sends = 0; const keys: string[] = [], soon = new Date(Date.now() + 1000).toISOString();
    mockApi.request.mockImplementation(async (path, init) => {
        if (path.endsWith('/generation-quotes')) return { ...quote, mode: 'custom', model_id: custom.model_id, expires_at: soon };
        if (path.endsWith('/generations')) {
            keys.push(JSON.parse(init.body).idempotency_key); sends++;
            if (sends === 1) throw new ApiError(503, 'pair_acceptance_unknown'); return { ...generation, idempotent: true };
        }
        return baseResponse(path, init);
    });
    await mount(); await mode('custom'); await edit('lyrics', 'Submitted words'); await edit('styles', 'warm piano');
    await act(async () => getMusicCreateSession(mockApi as unknown as ApiClient).edit({ instrumental: false }));
    const rights = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0];
    await act(async () => rights.props.onClick({ nativeEvent: {} }));
    await click(t('music.create.review')); await click(t('music.create.confirm', { credits: 10 }));
    await edit('lyrics', 'Changed draft'); await act(async () => jest.advanceTimersByTime(2000)); await remount();
    expect(button(t('music.create.check')).props.accessibilityState.disabled).toBe(false);
    await click(t('music.create.check')); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    await click(t('music.create.submittedLyrics')); expect(text('Submitted words').length).toBeGreaterThan(0); expect(text('Changed draft')).toHaveLength(0);
});
test('unsubmitted expiry disables confirm and account change removes quote', async () => {
    jest.useFakeTimers(); mockApi.request.mockImplementation((path, init) => path.endsWith('/generation-quotes') ? { ...quote, expires_at: new Date(Date.now() + 1000).toISOString() } : baseResponse(path, init));
    await mount(); await edit('prompt', 'Piano'); await click(t('music.create.review'));
    await act(async () => jest.advanceTimersByTime(1001)); expect(button(t('music.create.confirm', { credits: 10 })).props.accessibilityState.disabled).toBe(true);
    await act(async () => bindCacheUser('another-user')); expect(button(t('music.create.confirm', { credits: 10 }))).toBeUndefined();
});
const ready = { ...view.candidates[0], state: 'ready', song_id: 'song-id', job_id: JOB, audio_url: `/api/v1/jobs/${JOB}/asset` };
test('candidate selection mounts only one player and song navigation works', async () => {
    const entries = [{ id: view.id, createdAt: 0, missing: false, input: custom, view: { ...view, candidates: [ready, { ...ready, ordinal: 2, label: 'B', song_id: 'other-song' }] } }];
    await act(async () => root.render(<MusicQueue entries={entries} activeCount={1} limit={4} />));
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(0);
    await click(t('music.playNamed', { title: 'A' })); await click(t('music.playNamed', { title: 'B' }));
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(1);
    await click(t('music.create.openSong')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/[id]', params: { id: 'song-id' } });
});
test.each(['failed', 'refunded', 'future_state'])('candidate %s has correct terminal copy', async state => {
    await act(async () => root.render(<MusicCandidateCard candidate={{ ...ready, state }} onPlay={jest.fn()} />));
    expect(text(t(`music.create.${state === 'future_state' ? 'running' : state}`)).length).toBeGreaterThan(0);
    if (state === 'failed') expect(text(t('music.create.refunded'))).toHaveLength(0);
    expect(button(t('music.playNamed', { title: 'A' }))).toBeUndefined();
});
test('unsafe candidate paths are never playable', () => {
    for (const audio_url of ['https://evil.test/asset', `${ready.audio_url}?x=1`, `/api/v1/jobs/${view.id}/asset`, `${ready.audio_url}\n`]) expect(candidatePlayback({ ...ready, audio_url })).toBeNull();
});
test('lyrics insertion uses selection, appends, and respects max; instrumental result hidden', async () => {
    expect(insertLyricsLabel('abc', '[Verse]', 100)?.value).toBe('abc\n[Verse]\n');
    expect(insertLyricsLabel('abc', '[Verse]', 100, { start: 0, end: 1 })?.value).toBe('[Verse]\nbc');
    expect(insertLyricsLabel('abc', '[Verse]', 3)).toBeNull();
    await act(async () => root.render(<MusicLyricsPanel value="words" instrumental />)); expect(button(t('music.create.submittedLyrics'))).toBeUndefined();
});
test('poll off propagates to screen and stops all future requests', async () => {
    jest.useFakeTimers();
    mockApi.request.mockImplementation((path, init) => path.includes('/generations/') ? Promise.reject(new ApiError(404, 'music_unavailable')) : baseResponse(path, init));
    await mount(); await edit('prompt', 'Piano'); await click(t('music.create.review')); await click(t('music.create.confirm', { credits: 10 }));
    await act(async () => jest.advanceTimersByTimeAsync(800)); expect(text(t('music.off')).length).toBeGreaterThan(0);
    const count = mockApi.request.mock.calls.length; await remount(); await act(async () => jest.advanceTimersByTimeAsync(20000));
    expect(mockApi.request).toHaveBeenCalledTimes(count);
});
test('server concurrency rejection displays the local slot message', async () => {
    mockApi.request.mockImplementation((path, init) => path.endsWith('/generations') ? Promise.reject(new ApiError(409, 'concurrency_limit')) : baseResponse(path, init));
    await mount(); await edit('prompt', 'Piano'); await click(t('music.create.review')); await click(t('music.create.confirm', { credits: 10 }));
    expect(text(t('music.create.no_slot')).length).toBeGreaterThan(0);
});
test('editing while draft loads keeps local text and still obtains its revision', async () => {
    let finish!: (value: unknown) => void;
    mockApi.request.mockImplementation((path, init) => path.endsWith('/drafts/custom') && !init ? new Promise(resolve => { finish = resolve; }) : baseResponse(path, init));
    await mount(); await mode('custom'); await edit('lyrics', 'New local words'); await edit('styles', 'warm piano');
    await act(async () => finish({ draft: { ...draft, lyrics: 'Old server words' } }));
    expect(field(t('music.create.lyrics')).props.value).toBe('New local words');
    expect(button(t('music.create.review')).props.accessibilityState.disabled).toBe(false);
});

test('F1 Check the result stays enabled when current model or text limits change', async () => {
    const changed = { ...entitlements, models: entitlements.models.map(model => ({ ...model })), custom_drafts: { ...entitlements.custom_drafts } };
    let sends = 0; const keys: string[] = [];
    mockApi.request.mockImplementation((path, init) => {
        if (path.endsWith('/entitlements')) return changed;
        if (path.endsWith('/generations')) {
            keys.push(JSON.parse(init.body).idempotency_key);
            if (++sends === 1) throw new ApiError(503, 'pair_acceptance_unknown');
        }
        return baseResponse(path, init);
    });
    await mount(); await edit('prompt', 'Piano'); await edit('songTitle', 'Evening');
    await click(t('music.create.review')); await click(t('music.create.confirm', { credits: 10 }));
    changed.models[0].available = false; changed.custom_drafts.title_max = 1;
    await remount(); expect(button(t('music.create.check')).props.accessibilityState.disabled).toBe(false);
    await click(t('music.create.check')); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

test('F1 Discard forgets an ambiguous attempt without sending a cancellation and allows a new quote', async () => {
    mockApi.request.mockImplementation((path, init) => path.endsWith('/generations')
        ? Promise.reject(new ApiError(503, 'pair_acceptance_unknown')) : baseResponse(path, init));
    await mount(); expect(button(t('music.create.discard'))).toBeUndefined();
    await edit('prompt', 'Piano'); await click(t('music.create.review')); await click(t('music.create.confirm', { credits: 10 }));
    expect(text(t('music.create.discardBody')).length).toBeGreaterThan(0);
    const requests = mockApi.request.mock.calls.length;
    await click(t('music.create.discard'));
    expect(mockApi.request).toHaveBeenCalledTimes(requests);
    await remount();
    expect(mockApi.request.mock.calls.slice(requests)).toEqual([['/api/v1/music/entitlements']]);
    expect(button(t('music.create.check'))).toBeUndefined(); expect(button(t('music.create.discard'))).toBeUndefined();
    expect(button(t('music.create.review')).props.accessibilityState.disabled).toBe(false);
    await click(t('music.create.review')); expect(button(t('music.create.confirm', { credits: 10 }))).toBeDefined();
});

test.each([[400, 'prompt_not_allowed'], [503, 'model_unavailable'], [503, 'plan_unavailable']] as const)(
    'F3 %i %s displays specific localized copy', async (status, code) => {
        mockApi.request.mockImplementation((path, init) => path.endsWith('/generation-quotes')
            ? Promise.reject(new ApiError(status, code)) : baseResponse(path, init));
        await mount(); await edit('prompt', 'Piano'); await click(t('music.create.review'));
        expect(text(t(`music.create.${code}`)).length).toBeGreaterThan(0);
        expect(text(t('music.create.error'))).toHaveLength(0);
    });

test('F3 the rights blocker has its own message, separate from the checkbox label', async () => {
    await mount(); await mode('custom'); await edit('lyrics', 'My lyrics'); await edit('styles', 'warm piano');
    await act(async () => getMusicCreateSession(mockApi as unknown as ApiClient).edit({ instrumental: false }));
    expect(t('music.create.rights_required')).not.toBe(t('music.create.rights'));
    expect(text(t('music.create.rights_required')).length).toBeGreaterThan(0);
    expect(button(t('music.create.review')).props.accessibilityState.disabled).toBe(true);
    const rights = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0];
    expect(rights.props.accessibilityLabel).toBe(t('music.create.rights'));
    await act(async () => rights.props.onClick({ nativeEvent: {} }));
    expect(text(t('music.create.rights_required'))).toHaveLength(0);
    expect(button(t('music.create.review')).props.accessibilityState.disabled).toBe(false);
});
