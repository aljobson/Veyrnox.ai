import type { ApiClient } from '../src/lib/api';
import { estimateTokens, isLongText } from '../src/lib/chatLongText';
import type { Persona } from '../src/lib/chatLibrary';
import {
    buildMusicLyricistProfile, buildMusicLyricistPrompt, isMusicLyricistProfile, musicLyricistLabel,
    openMusicLyricistChat, MUSIC_LYRICIST_INSTRUCTION_PREFIX, MUSIC_LYRICIST_NAME_PREFIX,
    type MusicLyricistHandoffDeps,
} from '../src/lib/music/lyricistProfile';

const profile: Persona = {
    id: 'profile-1', name: `${MUSIC_LYRICIST_NAME_PREFIX}Harbour`,
    instructions: `${MUSIC_LYRICIST_INSTRUCTION_PREFIX}\nPrivate`, modelId: null, thinking: false, web: false,
};
const api = {} as ApiClient;

test('builds a private original-writing profile only after ownership attestation', () => {
    expect(buildMusicLyricistProfile({ name: 'Harbour', direction: 'Sparse.', examples: 'Mine.' })).toEqual({ ok: false, error: 'incomplete' });
    const built = buildMusicLyricistProfile({ name: ' Harbour ', direction: ' Sparse imagery. ', examples: ' My own line. ', ownsExamples: true });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({ name: `${MUSIC_LYRICIST_NAME_PREFIX}Harbour`, model_id: null, thinking: false, web: false });
    expect(built.value.instructions).toContain(MUSIC_LYRICIST_INSTRUCTION_PREFIX);
    expect(built.value.instructions).toMatch(/Never reproduce a distinctive line/);
    expect(built.value.instructions).toMatch(/Do not imitate a living artist/);
    expect(built.value.instructions.length).toBeLessThanOrEqual(4000);
    expect(estimateTokens(built.value.instructions)).toBeLessThanOrEqual(1000);
});

test('server-equivalent token limits reject non-ASCII instructions before a request', () => {
    const built = buildMusicLyricistProfile({ name: '海', direction: '海'.repeat(500), examples: '歌'.repeat(2500), ownsExamples: true });
    expect(built).toEqual({ ok: false, error: 'instructions_too_long' });
    const ascii = buildMusicLyricistProfile({ name: 'N', direction: 'd'.repeat(500), examples: 'e'.repeat(2500), ownsExamples: true });
    expect(ascii.ok).toBe(true);
});

test('only exact marker profiles with a visible label enter Music', () => {
    expect(isMusicLyricistProfile(profile)).toBe(true);
    expect(musicLyricistLabel(profile)).toBe('Harbour');
    expect(isMusicLyricistProfile({ ...profile, name: `${MUSIC_LYRICIST_NAME_PREFIX}   ` })).toBe(false);
    expect(isMusicLyricistProfile({ ...profile, name: 'Harbour' })).toBe(false);
    expect(isMusicLyricistProfile({ ...profile, instructions: 'Generic' })).toBe(false);
});

test.each([['ASCII', 'a'], ['non-ASCII', '歌']])('%s Chat draft is accepted only below both standard limits', (_label, unit) => {
    let accepted = '';
    let firstRejected = -1;
    for (let count = 0; count <= 8000; count += 1) {
        const result = buildMusicLyricistPrompt({ request: 'Tighten the chorus.', lyrics: unit.repeat(count) });
        if (result.ok) accepted = result.value;
        else { firstRejected = count; break; }
    }
    expect(firstRejected).toBeGreaterThan(0);
    expect(accepted.length).toBeLessThanOrEqual(8000);
    expect(estimateTokens(accepted)).toBeLessThanOrEqual(2000);
    expect(isLongText(accepted)).toBe(false);
    expect(buildMusicLyricistPrompt({ request: 'Tighten the chorus.', lyrics: unit.repeat(firstRejected) })).toEqual({ ok: false, error: 'prompt_too_long' });
});

function deps(overrides: Partial<MusicLyricistHandoffDeps> = {}) {
    let owner = 'owner-a';
    const calls: string[] = [];
    const value: MusicLyricistHandoffDeps & { setOwner(next: string): void; calls: string[] } = {
        owner: () => owner,
        listModels: async () => { calls.push('models'); return [{ id: 'chat-fast', name: 'Fast', maker_label: 'Veyrnox', credits_per_reply: 1, gated: false }]; },
        start: async (_api, _profile, model, current) => { calls.push(`start:${model}`); if (!current()) throw new Error('stale'); return 'thread-1'; },
        persist: async (_id, prompt) => { calls.push('persist'); return prompt; },
        deleteRemote: async () => { calls.push('delete'); },
        forgetLocal: async () => { calls.push('forget'); },
        ...overrides,
        setOwner: next => { owner = next; }, calls,
    };
    return value;
}

test('handoff creates a profiled thread and persists an unsent standard draft', async () => {
    const d = deps();
    await expect(openMusicLyricistChat({ api, profile, request: 'Tighten the chorus.', lyrics: 'My words' }, d))
        .resolves.toEqual({ ok: true, threadId: 'thread-1' });
    expect(d.calls).toEqual(['models', 'start:chat-fast', 'persist']);
});

test('handoff refuses missing models before creating a thread', async () => {
    const d = deps({ listModels: async () => [] });
    await expect(openMusicLyricistChat({ api, profile, request: 'Help.', lyrics: '' }, d))
        .resolves.toEqual({ ok: false, error: 'model_unavailable' });
    expect(d.calls).toEqual([]);
});

test.each(['null', 'throw'] as const)('a %s draft write deletes the known thread and local state', async mode => {
    const d = deps({ persist: async () => mode === 'null' ? null : Promise.reject(new Error('disk')) });
    await expect(openMusicLyricistChat({ api, profile, request: 'Help.', lyrics: 'Mine' }, d))
        .resolves.toEqual({ ok: false, error: 'handoff_failed' });
    expect(d.calls).toEqual(['models', 'start:chat-fast', 'delete', 'forget']);
});

test('account switch after thread creation never persists or mutates the new owner draft store', async () => {
    const d = deps();
    d.start = async () => { d.calls.push('start:chat-fast'); d.setOwner('owner-b'); return 'thread-1'; };
    await expect(openMusicLyricistChat({ api, profile, request: 'Help.', lyrics: 'Mine' }, d))
        .resolves.toEqual({ ok: false, error: 'account_changed' });
    expect(d.calls).toEqual(['models', 'start:chat-fast', 'delete']);
});

test('an account switch after exact draft persistence preserves the committed thread and draft pair', async () => {
    const d = deps();
    d.persist = async (_id, prompt) => { d.calls.push('persist'); d.setOwner('owner-b'); return prompt; };
    await expect(openMusicLyricistChat({ api, profile, request: 'Help.', lyrics: 'Mine' }, d))
        .resolves.toEqual({ ok: true, threadId: 'thread-1' });
    expect(d.calls).toEqual(['models', 'start:chat-fast', 'persist']);
});

test('thread setup failure has no unknown local state to clean', async () => {
    const d = deps({ start: async () => { throw new Error('patch'); } });
    await expect(openMusicLyricistChat({ api, profile, request: 'Help.', lyrics: 'Mine' }, d))
        .resolves.toEqual({ ok: false, error: 'handoff_failed' });
    expect(d.calls).toEqual(['models']);
});
