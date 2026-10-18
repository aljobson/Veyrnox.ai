import type { ApiClient } from './api';
import { chatApi } from './chat';

// ADR-0126: personas and folders for chat, over /api/v1/chat/*. The server is the authority on every rule; the
// limits here (copied from lib/chat.js) only save a round trip.

export const MAX_PERSONA_NAME = 60;
export const MAX_PERSONA_TEXT = 4000;
export const MAX_FOLDER_NAME = 60;
const MAX_PERSONA_TOKENS = MAX_PERSONA_TEXT / 4;
const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export interface Persona {
    readonly id: string;
    readonly name: string;
    readonly instructions: string;
    readonly modelId: string | null;
    readonly thinking: boolean;
    readonly web: boolean;
}

export interface Folder {
    readonly id: string;
    readonly name: string;
    readonly count: number;
}

export function parsePersonas(body: unknown): { enabled: boolean; personas: Persona[] } {
    const b = isObject(body) ? body : {};
    if (b.enabled !== true || !Array.isArray(b.personas)) return { enabled: false, personas: [] };
    const personas: Persona[] = [];
    for (const raw of b.personas) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        const instructions = str(raw.instructions);
        if (!id || !name || !instructions) continue;
        personas.push({ id, name, instructions, modelId: str(raw.model_id), thinking: raw.thinking === true, web: raw.web === true });
    }
    return { enabled: true, personas };
}

export function parseFolders(body: unknown): Folder[] {
    const list = isObject(body) && Array.isArray(body.folders) ? body.folders : [];
    const out: Folder[] = [];
    for (const raw of list) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        if (id && name) out.push({ id, name, count: typeof raw.count === 'number' && raw.count >= 0 ? raw.count : 0 });
    }
    return out;
}

// Chats per folder from the thread list, with null for chats in no folder.
export function folderCounts(threads: readonly { folder_id?: string | null }[]): Map<string | null, number> {
    const counts = new Map<string | null, number>();
    for (const t of threads) {
        const key = t.folder_id ?? null;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

export interface PersonaForm {
    readonly name: string;
    readonly instructions: string;
    readonly modelId: string | null;
    readonly thinking: boolean;
    readonly web: boolean;
}

export interface PersonaBody {
    readonly name: string;
    readonly instructions: string;
    readonly model_id: string | null;
    readonly thinking: boolean;
    readonly web: boolean;
}

export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export function validatePersonaForm(form: PersonaForm): Checked<PersonaBody> {
    const name = form.name.trim();
    const instructions = form.instructions.trim();
    if (!name) return { ok: false, message: 'Give the persona a name.' };
    if (name.length > MAX_PERSONA_NAME) return { ok: false, message: `The name can be at most ${MAX_PERSONA_NAME} characters.` };
    if (!instructions) return { ok: false, message: 'Write the instructions the persona should follow.' };
    if (instructions.length > MAX_PERSONA_TEXT || Math.ceil(instructions.length / 4) > MAX_PERSONA_TOKENS) return { ok: false, message: `The instructions can be at most ${MAX_PERSONA_TEXT} characters.` };
    if (form.modelId !== null && !MODEL_ID_RE.test(form.modelId)) return { ok: false, message: 'Choose a model from the list.' };
    return { ok: true, value: { name, instructions, model_id: form.modelId, thinking: form.thinking, web: form.web } };
}

export function validateFolderName(raw: string): Checked<string> {
    const name = raw.trim();
    if (!name) return { ok: false, message: 'Give the folder a name.' };
    if (name.length > MAX_FOLDER_NAME) return { ok: false, message: `The name can be at most ${MAX_FOLDER_NAME} characters.` };
    return { ok: true, value: name };
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
const enc = encodeURIComponent;

export const fetchPersonas = async (api: ApiClient) => parsePersonas(await api.request('/api/v1/chat/personas'));
export const fetchFolders = async (api: ApiClient) => parseFolders(await api.request('/api/v1/chat/folders'));

export const createPersona = (api: ApiClient, body: PersonaBody) => api.request('/api/v1/chat/personas', json('POST', body));
export const updatePersona = (api: ApiClient, id: string, body: PersonaBody) => api.request(`/api/v1/chat/personas/${enc(id)}`, json('PATCH', body));
export const deletePersona = (api: ApiClient, id: string) => api.request(`/api/v1/chat/personas/${enc(id)}`, json('DELETE'));

export const createFolder = (api: ApiClient, name: string) => api.request('/api/v1/chat/folders', json('POST', { name }));
export const renameFolder = (api: ApiClient, id: string, name: string) => api.request(`/api/v1/chat/folders/${enc(id)}`, json('PATCH', { name }));
export const deleteFolder = (api: ApiClient, id: string) => api.request(`/api/v1/chat/folders/${enc(id)}`, json('DELETE'));

// folder_id alone files a chat; null takes it out of its folder.
export const moveThread = (api: ApiClient, threadId: string, folderId: string | null) => api.request(`/api/v1/chat/threads/${enc(threadId)}`, json('PATCH', { folder_id: folderId }));

// There is no single call that starts a chat from a persona, so it is a chat on the persona's model (or the one
// picked) followed by its instructions. If the second step fails the half-made chat is removed.
export async function startFromPersona(api: ApiClient, persona: Persona, pickedModelId: string): Promise<string> {
    const thread = await chatApi(api).createThread(persona.modelId ?? pickedModelId);
    try {
        await api.request(`/api/v1/chat/threads/${enc(thread.id)}`, json('PATCH', { system_prompt: persona.instructions }));
    } catch (err) {
        await api.request(`/api/v1/chat/threads/${enc(thread.id)}`, json('DELETE')).catch(() => undefined);
        throw err;
    }
    return thread.id;
}

export function chatLibraryErrorMessage(err: unknown): string {
    const e = err as { status?: number; code?: string } | null;
    const status = typeof e?.status === 'number' ? e.status : -1;
    const code = String(e?.code ?? '');
    if (status === 0) return 'No connection. Check your internet and try again.';
    if (code === 'invalid_persona_name') return 'That persona name is not allowed. Use 1 to 60 characters.';
    if (code === 'invalid_instructions') return 'Check the instructions: they cannot be empty or longer than 4000 characters.';
    if (code === 'invalid_name') return 'That name is not allowed. Use 1 to 60 characters.';
    if (code === 'FOLDER_LIMIT') return 'You have too many folders. Delete one to make another.';
    if (code === 'persona_exists') return 'You already have a persona with that name.';
    if (code === 'personas_unavailable') return 'Personas are not available yet.';
    if (code === 'persona_not_found' || code === 'folder_not_found') return 'That is no longer there.';
    if (status === 503) return 'The service is busy. Try again in a moment.';
    if (status === 429) return 'Too many requests. Try again in a moment.';
    return 'Something went wrong. Try again.';
}
