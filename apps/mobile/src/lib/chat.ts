import { ApiError, type ApiClient } from './api';
import type { JobRead } from './chatStop';
import { createSseParser } from './sse';

export interface ChatModel {
    readonly id: string;
    readonly name: string;
    readonly maker_label: string;
    readonly credits_per_reply: number;
    readonly gated: boolean;
    // What the model offers on top of a plain reply, and what each costs (GET /api/v1/chat/models, ADR-0067).
    // Absent or null means not offered. Deep research is not read here: it is off in production.
    readonly options?: ChatModelOptions;
}

export interface ChatOptionOffer {
    readonly extra_credits: number;
}

export interface ChatModelOptions {
    readonly thinking?: ChatOptionOffer | null;
    readonly web?: ChatOptionOffer | null;
    readonly images?: ChatOptionOffer | null;
}

export const imagesExtra = (m: ChatModel): number | null => extraOf(m.options?.images);

// The two per-message choices sent as `options`. Thinking and Web can be on together.
export interface ReplyOptions {
    readonly thinking: boolean;
    readonly web: boolean;
}

export const NO_OPTIONS: ReplyOptions = { thinking: false, web: false };

const extraOf = (offer: ChatOptionOffer | null | undefined): number | null =>
    offer && Number.isInteger(offer.extra_credits) && offer.extra_credits > 0 ? offer.extra_credits : null;

export const thinkingExtra = (m: ChatModel): number | null => extraOf(m.options?.thinking);
export const webExtra = (m: ChatModel): number | null => extraOf(m.options?.web);

// Drops a choice the model does not offer, so a model change cannot leave a price on a switch that is gone.
export function cleanOptions(model: ChatModel, options: ReplyOptions): ReplyOptions {
    return { thinking: options.thinking && thinkingExtra(model) !== null, web: options.web && webExtra(model) !== null };
}

// Credits for one reply: the catalog base plus the catalog extra for each choice made. This only adds what the server
// listed; the server prices the turn itself (lib/chat.js replyPrice) and charges that.
export function replyPrice(model: ChatModel, options: ReplyOptions, imageCount = 0): number {
    const o = cleanOptions(model, options);
    // Any attached image adds the model's image extra once, however many there are (lib/chatTurn.js).
    const images = imageCount > 0 ? (imagesExtra(model) ?? 0) : 0;
    return model.credits_per_reply + (o.thinking ? (thinkingExtra(model) ?? 0) : 0) + (o.web ? (webExtra(model) ?? 0) : 0) + images;
}

export const optionsKey = (o: ReplyOptions): string => `${o.thinking ? 't' : ''}${o.web ? 'w' : ''}`;

// A retry of the same message with the same choices reuses its key, so the server charges it once. A different text
// or different choices are a different send and get a new key.
export interface PendingSend {
    readonly text: string;
    readonly options: string;
    readonly key: string;
}

export function sendKeyFor(previous: PendingSend | null, text: string, options: ReplyOptions, make: () => string, attached = ''): PendingSend {
    const sig = `${optionsKey(options)}|${attached}`;
    return previous && previous.text === text && previous.options === sig ? previous : { text, options: sig, key: make() };
}

export interface ChatThread {
    readonly id: string;
    readonly model_id: string;
    readonly title: string | null;
    readonly pinned: boolean;
    readonly folder_id?: string | null;
    // The chat's instructions (GET chat/threads/:id returns them).
    readonly system_prompt?: string | null;
    readonly updated_at: string;
}

export interface ChatMessage {
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly credits?: number | null;
}

export type TurnEvent =
    | { readonly type: 'start'; readonly credits: number; readonly balanceAfter: number | null; readonly jobId: string | null }
    | { readonly type: 'delta'; readonly text: string }
    | { readonly type: 'error'; readonly error: string }
    | { readonly type: 'done'; readonly status: string; readonly creditsCharged: number; readonly balance: number | null };

export function toTurnEvent(event: string, data: unknown): TurnEvent | null {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    switch (event) {
        case 'start':
            return { type: 'start', credits: num(d.credits) ?? 0, balanceAfter: num(d.balance_after), jobId: typeof d.job_id === 'string' ? d.job_id : null };
        case 'delta':
            return typeof d.text === 'string' ? { type: 'delta', text: d.text } : null;
        case 'error':
            return { type: 'error', error: typeof d.error === 'string' ? d.error : 'unknown' };
        case 'done':
            return {
                type: 'done',
                status: typeof d.status === 'string' ? d.status : 'unknown',
                creditsCharged: num(d.credits_charged) ?? 0,
                balance: num(d.balance),
            };
        default:
            return null;
    }
}

export const chatApi = (api: ApiClient) => ({
    listModels: () => api.request<{ models: ChatModel[] }>('/api/v1/chat/models').then((r) => r.models),
    // The models with the server's attachment limits (max_attachments, max_image_edge), which the app also knows as defaults.
    listModelsWithLimits: () =>
        api.request<{ models: ChatModel[]; max_attachments?: number; max_image_edge?: number }>('/api/v1/chat/models'),
    listThreads: () => api.request<{ threads: ChatThread[] }>('/api/v1/chat/threads').then((r) => r.threads),
    createThread: (modelId: string) =>
        api
            .request<{ thread: ChatThread }>('/api/v1/chat/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId }),
            })
            .then((r) => r.thread),
    getThread: (id: string) =>
        api.request<{ thread: ChatThread; messages: ChatMessage[] }>(`/api/v1/chat/threads/${encodeURIComponent(id)}`),
    // Rename and pin. The server refuses an empty or over-long title (MAX_TITLE 120) and unknown keys.
    updateThread: (id: string, patch: { title?: string; pinned?: boolean; system_prompt?: string; model_id?: string }) =>
        api
            .request<{ thread: ChatThread }>(`/api/v1/chat/threads/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            })
            .then((r) => r.thread),
    // A reply is a job (ADR-0067); its state tells whether a stopped turn has settled.
    getJob: (id: string) => api.request<JobRead>(`/api/v1/jobs/${encodeURIComponent(id)}`),
    // Asks about a send by its own key: the job it made, or `{ closed: true }` when it made none (then none ever can).
    closeSend: (key: string) =>
        api.request<unknown>('/api/v1/chat/sends/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idempotency_key: key }),
        }),
    deleteThread: (id: string) =>
        api.request<{ ok: true }>(`/api/v1/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // Sends one message and reports each server event as it arrives. Resolves when the stream ends.
    // The same idempotencyKey must be reused when retrying the same message: the server charges it once.
    async sendMessage(
        threadId: string,
        text: string,
        idempotencyKey: string,
        onEvent: (e: TurnEvent) => void,
        signal?: AbortSignal,
        options: ReplyOptions = NO_OPTIONS,
        attachments: readonly ({ source_key: string } | { source_asset: string })[] = [],
    ): Promise<{ readonly replay: boolean; readonly job: string | null }> {
        const res = await api.stream(`/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({
                text,
                idempotency_key: idempotencyKey,
                options: { thinking: options.thinking, web: options.web },
                // Present only when there are images, so a text turn keeps the shape it always had.
                ...(attachments.length ? { attachments } : {}),
            }),
            signal,
        });
        if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown');
        }
        // The server already holds a job for this key: it answers JSON, not a stream. That says a job exists, not how it ended.
        const type = res.headers?.get?.('content-type') ?? '';
        if (type && !type.includes('text/event-stream')) {
            const body = (await res.json().catch(() => ({}))) as { replay?: unknown; job_id?: unknown };
            if (body.replay === true) return { replay: true, job: typeof body.job_id === 'string' ? body.job_id : null };
            throw new ApiError(0, 'bad_answer');
        }
        if (!res.body) throw new ApiError(res.status, 'no_stream');
        let ended = false;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
                const event = toTurnEvent(frame.event, frame.data);
                if (event) onEvent(event);
                if (frame.event === 'done') ended = true;
            }
        }
        // `done` is written last on every path that ends a turn; a stream without it was cut off.
        if (!ended) throw new ApiError(0, 'stream_cut');
        return { replay: false, job: null };
    },
});

export const MAX_TITLE = 120;

// A title the server will take (1 to 120 characters once trimmed), or null.
export function cleanTitle(raw: string): string | null {
    const t = raw.trim();
    return t.length > 0 && t.length <= MAX_TITLE ? t : null;
}

// Pinned chats first, otherwise the order the server gave.
export function pinnedFirst<T extends { readonly pinned?: boolean }>(threads: readonly T[]): T[] {
    return [...threads.filter((t) => t.pinned), ...threads.filter((t) => !t.pinned)];
}

export const MAX_SYSTEM_PROMPT = 4000;

// The models a chat can be switched to: open ones. Cheapest first, so the price of a switch is easy to read.
export const switchableModels = (models: readonly ChatModel[]): ChatModel[] =>
    models.filter((m) => !m.gated).sort((a, b) => a.credits_per_reply - b.credits_per_reply || a.name.localeCompare(b.name));

// A pick from the in-chat model list is saved only when it names a different, open model; anything else changes nothing.
export const isModelSwitch = (currentId: string, pickedId: string, models: readonly ChatModel[]): boolean =>
    pickedId !== currentId && switchableModels(models).some((m) => m.id === pickedId);

// What a settings save sends: only what changed, so an untouched field is never rewritten.
export function settingsPatch(
    current: { readonly model_id: string; readonly system_prompt?: string | null },
    next: { readonly model_id: string; readonly instructions: string },
): { model_id?: string; system_prompt?: string } | null {
    const patch: { model_id?: string; system_prompt?: string } = {};
    if (next.model_id !== current.model_id) patch.model_id = next.model_id;
    if (next.instructions !== (current.system_prompt ?? '')) patch.system_prompt = next.instructions.slice(0, MAX_SYSTEM_PROMPT);
    return Object.keys(patch).length ? patch : null;
}

// The chats whose title contains the words typed (case-insensitive), as the web's list does. An empty search shows all.
export function searchThreads<T extends { readonly title: string | null }>(threads: readonly T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    return q ? threads.filter((t) => (t.title ?? '').toLowerCase().includes(q)) : [...threads];
}
