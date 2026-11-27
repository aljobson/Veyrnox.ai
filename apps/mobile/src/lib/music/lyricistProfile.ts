import type { ApiClient } from '../api';
import { appCache, getCacheUser } from '../appCache';
import { chatApi, type ChatModel } from '../chat';
import { CHAT_USER_TEXT_STANDARD_MAX, estimateTokens, isLongText } from '../chatLongText';
import { captureChat, forgetThread, writeDraft } from '../chatLocal';
import { startFromPersona, type Persona, type PersonaBody } from '../chatLibrary';

export const MUSIC_LYRICIST_NAME_PREFIX = 'Lyricist · ';
export const MUSIC_LYRICIST_INSTRUCTION_PREFIX = 'Veyrnox Music lyricist profile v1.';
export const MUSIC_LYRICIST_NAME_MAX = 40;
export const MUSIC_LYRICIST_DIRECTION_MAX = 500;
export const MUSIC_LYRICIST_EXAMPLES_MAX = 2500;
export const MUSIC_LYRICIST_REQUEST_MAX = 280;
export const MUSIC_LYRICIST_INSTRUCTIONS_MAX = 4000;
export const MUSIC_LYRICIST_INSTRUCTION_TOKENS_MAX = 1000;
export const MUSIC_LYRICIST_PROMPT_TOKENS_MAX = CHAT_USER_TEXT_STANDARD_MAX / 4;

type ProfileError = 'incomplete' | 'instructions_too_long';
type PromptError = 'request_required' | 'prompt_too_long';
export type Checked<T, E extends string> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

export function musicLyricistLabel(persona: Pick<Persona, 'name' | 'instructions'>): string {
    if (!persona.name.startsWith(MUSIC_LYRICIST_NAME_PREFIX)
        || !persona.instructions.startsWith(MUSIC_LYRICIST_INSTRUCTION_PREFIX)) return '';
    return persona.name.slice(MUSIC_LYRICIST_NAME_PREFIX.length).trim();
}

export function isMusicLyricistProfile(persona: Persona): boolean {
    return Boolean(persona.id && musicLyricistLabel(persona));
}

export function buildMusicLyricistProfile(input: {
    readonly name?: string; readonly direction?: string; readonly examples?: string; readonly ownsExamples?: boolean;
} = {}): Checked<PersonaBody, ProfileError> {
    const name = clean(input.name, MUSIC_LYRICIST_NAME_MAX);
    const direction = clean(input.direction, MUSIC_LYRICIST_DIRECTION_MAX);
    const examples = clean(input.examples, MUSIC_LYRICIST_EXAMPLES_MAX);
    if (!name || !direction || !examples || input.ownsExamples !== true) return { ok: false, error: 'incomplete' };
    const instructions = [
        MUSIC_LYRICIST_INSTRUCTION_PREFIX,
        'The user attested that they wrote or own the private examples below.',
        'Infer only broad craft traits such as imagery, cadence, density and structure.',
        'Never reproduce a distinctive line from an example. Write new lyrics for the current request.',
        'Do not imitate a living artist or claim the profile is a trained model.',
        '',
        'Preferred writing direction:',
        direction,
        '',
        'BEGIN PRIVATE OWNED EXAMPLES',
        examples,
        'END PRIVATE OWNED EXAMPLES',
    ].join('\n');
    if (instructions.length > MUSIC_LYRICIST_INSTRUCTIONS_MAX
        || estimateTokens(instructions) > MUSIC_LYRICIST_INSTRUCTION_TOKENS_MAX) {
        return { ok: false, error: 'instructions_too_long' };
    }
    return { ok: true, value: {
        name: `${MUSIC_LYRICIST_NAME_PREFIX}${name}`,
        instructions,
        model_id: null,
        thinking: false,
        web: false,
    } };
}

export function buildMusicLyricistPrompt(input: { readonly request?: string; readonly lyrics?: string } = {}): Checked<string, PromptError> {
    const request = clean(input.request, MUSIC_LYRICIST_REQUEST_MAX);
    if (!request) return { ok: false, error: 'request_required' };
    const lyrics = String(input.lyrics ?? '').replace(/\r\n?/g, '\n').trim();
    const prompt = [
        'Help me co-write original song lyrics. I wrote or own any draft included below.',
        '',
        'Editing request:',
        request,
        '',
        'Rules:',
        '- Follow the request while preserving wording and structure that I did not ask to change.',
        '- If no draft is provided, create a fresh original draft from the request.',
        '- Do not imitate a living artist or reproduce lyrics that are not included below; offer an original alternative instead.',
        '- Return only the revised lyrics between the exact lines “BEGIN REVISED LYRICS” and “END REVISED LYRICS”.',
        '- Do not put commentary, notes or a code fence inside those lines.',
        '',
        'BEGIN MY DRAFT',
        lyrics || '(No draft yet.)',
        'END MY DRAFT',
        '',
        'Required response shape:',
        'BEGIN REVISED LYRICS',
        '[revised lyrics only]',
        'END REVISED LYRICS',
    ].join('\n');
    if (prompt.length > CHAT_USER_TEXT_STANDARD_MAX
        || estimateTokens(prompt) > MUSIC_LYRICIST_PROMPT_TOKENS_MAX
        || isLongText(prompt)) return { ok: false, error: 'prompt_too_long' };
    return { ok: true, value: prompt };
}

export type MusicLyricistHandoffError = PromptError | 'account_changed' | 'model_unavailable' | 'handoff_failed';
export type MusicLyricistHandoffResult = Readonly<{ ok: true; threadId: string }> | Readonly<{ ok: false; error: MusicLyricistHandoffError }>;

export interface MusicLyricistHandoffDeps {
    owner(): string | undefined;
    listModels(api: ApiClient): Promise<readonly ChatModel[]>;
    start(api: ApiClient, persona: Persona, fallbackModelId: string, stillCurrent: () => boolean): Promise<string>;
    persist(threadId: string, prompt: string, owner: string): Promise<string | null>;
    deleteRemote(api: ApiClient, threadId: string): Promise<unknown>;
    forgetLocal(threadId: string, owner: string): Promise<unknown>;
}

const defaultDeps: MusicLyricistHandoffDeps = {
    owner: getCacheUser,
    listModels: api => chatApi(api).listModels(),
    start: startFromPersona,
    persist: (threadId, prompt, owner) => {
        const capture = captureChat(threadId, appCache, owner);
        return writeDraft(threadId, prompt, appCache, owner, capture);
    },
    deleteRemote: (api, threadId) => chatApi(api).deleteThread(threadId),
    forgetLocal: (threadId, owner) => forgetThread(threadId, appCache, owner),
};

export async function openMusicLyricistChat(input: {
    readonly api: ApiClient;
    readonly profile: Persona;
    readonly request: string;
    readonly lyrics: string;
    readonly stillCurrent?: () => boolean;
}, deps: MusicLyricistHandoffDeps = defaultDeps): Promise<MusicLyricistHandoffResult> {
    const checked = buildMusicLyricistPrompt(input);
    if (!checked.ok) return checked;
    const owner = deps.owner();
    const local = input.stillCurrent ?? (() => true);
    const current = () => Boolean(owner && deps.owner() === owner && local());
    if (!owner || !current()) return { ok: false, error: 'account_changed' };
    let threadId = '';
    try {
        const models = await deps.listModels(input.api);
        if (!current()) throw new Error('account_changed');
        const fallback = models.find(model => !model.gated);
        if (!input.profile.modelId && !fallback) return { ok: false, error: 'model_unavailable' };
        threadId = await deps.start(input.api, input.profile, fallback?.id ?? '', current);
        if (!current()) throw new Error('account_changed');
        const stored = await deps.persist(threadId, checked.value, owner);
        // The exact draft write is the transaction's commit point. If the account changes after it returns,
        // preserve the original owner's matched thread/draft pair; the caller fences stale navigation.
        if (stored !== checked.value) throw new Error('draft_failed');
        return { ok: true, threadId };
    } catch (error) {
        if (threadId) {
            await deps.deleteRemote(input.api, threadId).catch(() => undefined);
            if (current()) await deps.forgetLocal(threadId, owner).catch(() => undefined);
        }
        return { ok: false, error: current() ? 'handoff_failed' : 'account_changed' };
    }
}
