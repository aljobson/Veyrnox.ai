import { getCacheUser, subscribeCacheUser } from '../appCache';

export const MUSIC_LYRIC_BEGIN = 'BEGIN REVISED LYRICS';
export const MUSIC_LYRIC_END = 'END REVISED LYRICS';
export const MUSIC_LYRIC_REQUEST_MAX = 280;
export const MUSIC_LYRIC_HANDOFF_TTL_MS = 60 * 60 * 1000;

type ChatMessage = { readonly id: string; readonly role: string; readonly content: string; readonly status?: 'complete' | 'canceled' | 'error' };
type DraftIdentity = { readonly draftId: string | null; readonly draftRevision: number };

interface Pending extends DraftIdentity {
    readonly token: string;
    readonly owner: string;
    readonly sourceLyrics: string;
    readonly lyricLimit: number;
    readonly request: string;
    expiresAt: number;
    personaId?: string;
    threadId?: string;
    proposal?: { readonly messageId: string; readonly lyrics: string };
}

export type MusicLyricReview =
    | { readonly ok: true; readonly lyrics: string }
    | { readonly ok: false; readonly reason: 'missing' | 'stale' | 'over_length' };

const pending = new Map<string, Pending>();
subscribeCacheUser(() => pending.clear());

function token(): string {
    return `lyrics-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function hasMarkerLine(value: string): boolean {
    return value.replace(/\r\n?/g, '\n').split('\n').some(line => line === MUSIC_LYRIC_BEGIN || line === MUSIC_LYRIC_END);
}

function current(value: Pending | undefined, now: number): value is Pending {
    if (!value) return false;
    if (value.owner !== getCacheUser() || now > value.expiresAt) {
        pending.delete(value.token);
        return false;
    }
    return true;
}

function read(tokenValue: string | undefined, now = Date.now()): Pending | null {
    if (!tokenValue) return null;
    const value = pending.get(tokenValue);
    return current(value, now) ? value : null;
}

function refresh(value: Pending, now: number): void {
    value.expiresAt = now + MUSIC_LYRIC_HANDOFF_TTL_MS;
}

export function stageMusicLyricHandoff(input: DraftIdentity & {
    readonly sourceLyrics: string;
    readonly lyricLimit: number;
    readonly request: string;
}, now = Date.now()): string | null {
    const owner = getCacheUser();
    const request = input.request.trim();
    if (!owner || (input.draftId !== null && !input.draftId) || !Number.isInteger(input.draftRevision) || input.draftRevision < 0
        || !Number.isSafeInteger(input.lyricLimit) || input.lyricLimit < 1
        || Array.from(input.sourceLyrics).length > input.lyricLimit
        || !request || Array.from(request).length > MUSIC_LYRIC_REQUEST_MAX
        || hasMarkerLine(input.sourceLyrics) || hasMarkerLine(request)) return null;
    const id = token();
    pending.set(id, { token: id, owner, sourceLyrics: input.sourceLyrics, lyricLimit: input.lyricLimit,
        request, draftId: input.draftId, draftRevision: input.draftRevision, expiresAt: now + MUSIC_LYRIC_HANDOFF_TTL_MS });
    return id;
}

export function isMusicLyricHandoff(tokenValue: string | undefined, now = Date.now()): boolean {
    return read(tokenValue, now) !== null;
}

export function selectMusicLyricPersona(tokenValue: string, personaId: string, now = Date.now()): boolean {
    const value = read(tokenValue, now);
    if (!value || !personaId || value.threadId) return false;
    value.personaId = personaId;
    refresh(value, now);
    return true;
}

export function bindMusicLyricThread(tokenValue: string, personaId: string, threadId: string, now = Date.now()): boolean {
    const value = read(tokenValue, now);
    if (!value || !threadId || value.personaId !== personaId || value.threadId) return false;
    value.threadId = threadId;
    refresh(value, now);
    return true;
}

function buildPrompt(value: Pending): string {
    return [
        'Help me revise these song lyrics. Follow the private Lyricist profile for creative direction.',
        `Request: ${value.request}`,
        '',
        'Current lyrics:',
        value.sourceLyrics || '(No lyrics yet.)',
        '',
        `Return the complete proposed lyrics between exactly one ${MUSIC_LYRIC_BEGIN} line and one ${MUSIC_LYRIC_END} line.`,
        'You may explain your choices outside those marker lines.',
    ].join('\n');
}

export function musicLyricChatSeed(tokenValue: string | undefined, threadId: string, now = Date.now()): string | undefined {
    const value = read(tokenValue, now);
    return value?.threadId === threadId ? buildPrompt(value) : undefined;
}

export function parseMusicLyricProposal(content: string, limit: number): string {
    if (!Number.isSafeInteger(limit) || limit < 1) return '';
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
    const starts = lines.reduce<number[]>((out, line, index) => line === MUSIC_LYRIC_BEGIN ? [...out, index] : out, []);
    const ends = lines.reduce<number[]>((out, line, index) => line === MUSIC_LYRIC_END ? [...out, index] : out, []);
    if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0] + 1) return '';
    const lyrics = lines.slice(starts[0] + 1, ends[0]).join('\n').trim();
    // Match the draft save boundary while preserving tabs and line breaks used by lyric structure.
    // eslint-disable-next-line no-control-regex
    const invalid = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(lyrics);
    return lyrics && !invalid && Array.from(lyrics).length <= limit ? lyrics : '';
}

export function latestMusicLyricProposal(messages: readonly ChatMessage[], sending: boolean, limit: number): { messageId: string; lyrics: string } | null {
    if (sending || !messages.length) return null;
    const latest = messages[messages.length - 1];
    if (latest.role !== 'assistant' || (latest.status !== undefined && latest.status !== 'complete')) return null;
    const lyrics = parseMusicLyricProposal(latest.content, limit);
    return lyrics ? { messageId: latest.id, lyrics } : null;
}

export function latestServerMusicLyricProposal(messages: readonly ChatMessage[], sending: boolean, limit: number,
    serverMessageIds: ReadonlySet<string>): { messageId: string; lyrics: string } | null {
    const proposal = latestMusicLyricProposal(messages, sending, limit);
    return proposal && serverMessageIds.has(proposal.messageId) ? proposal : null;
}

export function musicLyricProposalLimit(tokenValue: string | undefined, threadId: string, now = Date.now()): number | null {
    const value = read(tokenValue, now);
    return value?.threadId === threadId ? value.lyricLimit : null;
}

export function stageMusicLyricProposal(tokenValue: string, threadId: string, messageId: string, content: string, now = Date.now()): boolean {
    const value = read(tokenValue, now);
    if (!value || value.threadId !== threadId || !messageId) return false;
    const lyrics = parseMusicLyricProposal(content, value.lyricLimit);
    if (!lyrics) return false;
    value.proposal = { messageId, lyrics };
    refresh(value, now);
    return true;
}

export function consumeMusicLyricReview(tokenValue: string, currentDraft: DraftIdentity & {
    readonly sourceLyrics: string;
    readonly lyricLimit: number;
}, now = Date.now()): MusicLyricReview {
    const value = read(tokenValue, now);
    if (!value) return { ok: false, reason: 'missing' };
    pending.delete(tokenValue);
    if (!value.proposal || value.draftId !== currentDraft.draftId || value.draftRevision !== currentDraft.draftRevision
        || value.sourceLyrics !== currentDraft.sourceLyrics) return { ok: false, reason: 'stale' };
    if (Array.from(value.proposal.lyrics).length > currentDraft.lyricLimit) return { ok: false, reason: 'over_length' };
    return { ok: true, lyrics: value.proposal.lyrics };
}

export function discardMusicLyricHandoff(tokenValue: string): void {
    pending.delete(tokenValue);
}

export function resetMusicLyricHandoffsForTest(): void {
    pending.clear();
}
