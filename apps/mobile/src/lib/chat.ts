import { ApiError, type ApiClient } from './api';
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
export function replyPrice(model: ChatModel, options: ReplyOptions): number {
    const o = cleanOptions(model, options);
    return model.credits_per_reply + (o.thinking ? (thinkingExtra(model) ?? 0) : 0) + (o.web ? (webExtra(model) ?? 0) : 0);
}

export const optionsKey = (o: ReplyOptions): string => `${o.thinking ? 't' : ''}${o.web ? 'w' : ''}`;

// A retry of the same message with the same choices reuses its key, so the server charges it once. A different text
// or different choices are a different send and get a new key.
export interface PendingSend {
    readonly text: string;
    readonly options: string;
    readonly key: string;
}

export function sendKeyFor(previous: PendingSend | null, text: string, options: ReplyOptions, make: () => string): PendingSend {
    const sig = optionsKey(options);
    return previous && previous.text === text && previous.options === sig ? previous : { text, options: sig, key: make() };
}

export interface ChatThread {
    readonly id: string;
    readonly model_id: string;
    readonly title: string | null;
    readonly pinned: boolean;
    readonly folder_id?: string | null;
    readonly updated_at: string;
}

export interface ChatMessage {
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly credits?: number | null;
}

export type TurnEvent =
    | { readonly type: 'start'; readonly credits: number; readonly balanceAfter: number | null }
    | { readonly type: 'delta'; readonly text: string }
    | { readonly type: 'error'; readonly error: string }
    | { readonly type: 'done'; readonly status: string; readonly creditsCharged: number; readonly balance: number | null };

export function toTurnEvent(event: string, data: unknown): TurnEvent | null {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    switch (event) {
        case 'start':
            return { type: 'start', credits: num(d.credits) ?? 0, balanceAfter: num(d.balance_after) };
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
    ) {
        const res = await api.stream(`/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ text, idempotency_key: idempotencyKey, options: { thinking: options.thinking, web: options.web } }),
            signal,
        });
        if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown');
        }
        if (!res.body) throw new ApiError(res.status, 'no_stream');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
                const event = toTurnEvent(frame.event, frame.data);
                if (event) onEvent(event);
            }
        }
    },
});
