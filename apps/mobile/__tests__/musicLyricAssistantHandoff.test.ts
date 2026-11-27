import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import {
    bindMusicLyricThread,
    consumeMusicLyricReview,
    isMusicLyricHandoff,
    latestMusicLyricProposal,
    latestServerMusicLyricProposal,
    MUSIC_LYRIC_BEGIN,
    MUSIC_LYRIC_END,
    MUSIC_LYRIC_HANDOFF_TTL_MS,
    musicLyricChatSeed,
    musicLyricProposalLimit,
    parseMusicLyricProposal,
    resetMusicLyricHandoffsForTest,
    selectMusicLyricPersona,
    stageMusicLyricHandoff,
    stageMusicLyricProposal,
} from '../src/lib/music/lyricAssistantHandoff';

const NOW = 1_800_000_000_000;
const draft = { draftId: 'draft-one', draftRevision: 3, sourceLyrics: '[Verse]\nOld line', lyricLimit: 3000 };

beforeEach(async () => {
    resetCacheUser();
    resetMusicLyricHandoffsForTest();
    await bindCacheUser('music-user');
});
afterEach(() => { resetCacheUser(); resetMusicLyricHandoffsForTest(); });

function staged() {
    const value = stageMusicLyricHandoff({ ...draft, request: 'Make the imagery more vivid.' }, NOW);
    expect(value).toBeTruthy();
    return value!;
}

test('an opaque account-bound token carries no lyric or request text', () => {
    const token = staged();
    expect(token).not.toContain('Old line');
    expect(token).not.toContain('vivid');
    expect(isMusicLyricHandoff(token, NOW)).toBe(true);
});

test('source and request marker collisions are refused', () => {
    expect(stageMusicLyricHandoff({ ...draft, sourceLyrics: `${MUSIC_LYRIC_BEGIN}\nMine`, request: 'Revise' }, NOW)).toBeNull();
    expect(stageMusicLyricHandoff({ ...draft, request: `Use this\n${MUSIC_LYRIC_END}` }, NOW)).toBeNull();
});

test('one persona and one exact thread are bound before Chat receives a seed', () => {
    const token = staged();
    expect(musicLyricChatSeed(token, 'thread-one', NOW)).toBeUndefined();
    expect(selectMusicLyricPersona(token, 'persona-one', NOW)).toBe(true);
    expect(bindMusicLyricThread(token, 'persona-two', 'thread-one', NOW)).toBe(false);
    expect(bindMusicLyricThread(token, 'persona-one', 'thread-one', NOW)).toBe(true);
    expect(bindMusicLyricThread(token, 'persona-one', 'thread-two', NOW)).toBe(false);
    expect(musicLyricChatSeed(token, 'thread-two', NOW)).toBeUndefined();
    expect(musicLyricChatSeed(token, 'thread-one', NOW)).toContain('Make the imagery more vivid.');
});

test('parser requires exactly one complete bounded block', () => {
    const valid = `Notes\n${MUSIC_LYRIC_BEGIN}\n[Verse]\nNew line\n${MUSIC_LYRIC_END}\nDone`;
    expect(parseMusicLyricProposal(valid, 3000)).toBe('[Verse]\nNew line');
    expect(parseMusicLyricProposal(`${valid}\n${MUSIC_LYRIC_BEGIN}\nAgain\n${MUSIC_LYRIC_END}`, 3000)).toBe('');
    expect(parseMusicLyricProposal(`${MUSIC_LYRIC_BEGIN}\n${'x'.repeat(11)}\n${MUSIC_LYRIC_END}`, 10)).toBe('');
    expect(parseMusicLyricProposal(`${MUSIC_LYRIC_BEGIN}\nUnsafe\u0000line\n${MUSIC_LYRIC_END}`, 3000)).toBe('');
});

test('only the latest completed assistant reply can become a proposal', () => {
    const old = `${MUSIC_LYRIC_BEGIN}\nOld proposal\n${MUSIC_LYRIC_END}`;
    const latest = `${MUSIC_LYRIC_BEGIN}\nLatest proposal\n${MUSIC_LYRIC_END}`;
    const messages = [
        { id: 'a1', role: 'assistant', content: old },
        { id: 'u2', role: 'user', content: 'Try again' },
        { id: 'a2', role: 'assistant', content: latest },
    ];
    expect(latestMusicLyricProposal(messages, true, 3000)).toBeNull();
    expect(latestMusicLyricProposal(messages, false, 3000)).toEqual({ messageId: 'a2', lyrics: 'Latest proposal' });
    expect(latestMusicLyricProposal([...messages, { id: 'a3', role: 'assistant', content: 'No markers' }], false, 3000)).toBeNull();
    expect(latestMusicLyricProposal([...messages.slice(0, 2), { id: 'a2', role: 'assistant', status: 'canceled', content: latest }], false, 3000)).toBeNull();
    expect(latestMusicLyricProposal([...messages, { id: 'u3', role: 'user', content: 'One more change' }], false, 3000)).toBeNull();
    expect(latestServerMusicLyricProposal(messages, false, 3000, new Set(['a1']))).toBeNull();
    expect(latestServerMusicLyricProposal(messages, false, 3000, new Set(['a1', 'a2']))).toEqual({ messageId: 'a2', lyrics: 'Latest proposal' });
});

test('Music review is explicit and rejects changed drafts or active-model limits', () => {
    const token = staged();
    selectMusicLyricPersona(token, 'persona-one', NOW);
    bindMusicLyricThread(token, 'persona-one', 'thread-one', NOW);
    const reply = `${MUSIC_LYRIC_BEGIN}\nNew line\n${MUSIC_LYRIC_END}`;
    expect(stageMusicLyricProposal(token, 'thread-two', 'a1', reply, NOW)).toBe(false);
    expect(stageMusicLyricProposal(token, 'thread-one', 'a1', reply, NOW)).toBe(true);
    expect(consumeMusicLyricReview(token, { ...draft, sourceLyrics: 'Changed elsewhere' }, NOW)).toEqual({ ok: false, reason: 'stale' });

    const second = staged();
    selectMusicLyricPersona(second, 'persona-one', NOW);
    bindMusicLyricThread(second, 'persona-one', 'thread-one', NOW);
    stageMusicLyricProposal(second, 'thread-one', 'a2', reply, NOW);
    expect(consumeMusicLyricReview(second, { ...draft, lyricLimit: 3 }, NOW)).toEqual({ ok: false, reason: 'over_length' });
});

test('account change clears the selection, thread and proposal', async () => {
    const token = staged();
    selectMusicLyricPersona(token, 'persona-one', NOW);
    bindMusicLyricThread(token, 'persona-one', 'thread-one', NOW);
    await bindCacheUser('another-user');
    expect(isMusicLyricHandoff(token, NOW)).toBe(false);
    expect(musicLyricChatSeed(token, 'thread-one', NOW)).toBeUndefined();
});

test('the one-hour window refreshes at binding but expired proposal staging fails', () => {
    const token = staged();
    const almostExpired = NOW + MUSIC_LYRIC_HANDOFF_TTL_MS - 1;
    expect(selectMusicLyricPersona(token, 'persona-one', almostExpired)).toBe(true);
    expect(bindMusicLyricThread(token, 'persona-one', 'thread-one', almostExpired)).toBe(true);
    expect(musicLyricProposalLimit(token, 'thread-one', almostExpired + MUSIC_LYRIC_HANDOFF_TTL_MS - 1)).toBe(3000);
    const reply = `${MUSIC_LYRIC_BEGIN}\nNew line\n${MUSIC_LYRIC_END}`;
    expect(stageMusicLyricProposal(token, 'thread-one', 'a1', reply, almostExpired + MUSIC_LYRIC_HANDOFF_TTL_MS + 1)).toBe(false);
    expect(isMusicLyricHandoff(token, almostExpired + MUSIC_LYRIC_HANDOFF_TTL_MS + 1)).toBe(false);
});
test('missing or already-consumed tokens cannot return a second proposal', () => {
    expect(consumeMusicLyricReview('missing', draft, NOW)).toEqual({ ok: false, reason: 'missing' });
    const token = staged();
    selectMusicLyricPersona(token, 'persona-one', NOW); bindMusicLyricThread(token, 'persona-one', 'thread-one', NOW);
    stageMusicLyricProposal(token, 'thread-one', 'a1', `${MUSIC_LYRIC_BEGIN}\nNew\n${MUSIC_LYRIC_END}`, NOW);
    expect(consumeMusicLyricReview(token, draft, NOW)).toEqual({ ok: true, lyrics: 'New' });
    expect(consumeMusicLyricReview(token, draft, NOW)).toEqual({ ok: false, reason: 'missing' });
});
