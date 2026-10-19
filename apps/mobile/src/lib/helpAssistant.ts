import { ApiError, type ApiClient } from './api';

// Ask Vey, the help assistant: POST /api/v1/help answers one question with product guidance. It is free and rate
// limited, and the answer only ever carries words: the web's pointers to its own buttons are ignored here.
export const HELP_MAX_QUESTION = 500;
const MAX_ANSWER = 700;
const HISTORY_LIMIT = 6;

export interface HelpTurn {
    readonly role: 'user' | 'assistant';
    readonly content: string;
}

export function validQuestion(question: string): boolean {
    const q = question.trim();
    return q.length > 0 && q.length <= HELP_MAX_QUESTION;
}

// The server keeps the last six turns and trims each; do the same so the request is never refused for length.
export function helpBody(question: string, history: readonly HelpTurn[]) {
    return {
        question: question.trim(),
        pathname: '/app',
        history: history.slice(-HISTORY_LIMIT).map((h) => ({ role: h.role, content: h.content.slice(0, h.role === 'user' ? 500 : 700) })),
    };
}

export function parseHelpAnswer(body: unknown): string | null {
    const plan = body && typeof body === 'object' ? (body as { plan?: unknown }).plan : null;
    const message = plan && typeof plan === 'object' ? (plan as { message?: unknown }).message : null;
    return typeof message === 'string' && message.trim() ? message.trim().slice(0, MAX_ANSWER) : null;
}

export async function askHelp(api: Pick<ApiClient, 'request'>, question: string, history: readonly HelpTurn[]): Promise<string> {
    if (!validQuestion(question)) throw new ApiError(400, 'invalid_question');
    const body = await api.request<unknown>('/api/v1/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(helpBody(question, history)),
    });
    const answer = parseHelpAnswer(body);
    if (!answer) throw new ApiError(502, 'empty_answer');
    return answer;
}

export type HelpErrorKey = 'help.err.network' | 'help.err.rate' | 'help.err.question' | 'help.err.failed';

export function helpErrorKey(err: unknown): HelpErrorKey {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'help.err.network';
        if (err.status === 429) return 'help.err.rate';
        if (err.code === 'invalid_question') return 'help.err.question';
    }
    return 'help.err.failed';
}
