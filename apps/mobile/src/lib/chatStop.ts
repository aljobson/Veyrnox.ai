import type { ChatMessage } from './chat';

// After Stop or a dropped connection (ADR-0067, ported from app/veyrnox/_lib/chatStop.js). The server keeps what had
// arrived and charges it, but saves the stopped turn a moment after the phone lets go. So the turn is looked for a few
// times, about three seconds in all, instead of reading the chat once and coming back without it. Before the reply's
// `start` there is no job id, so the server is first asked about the send by its key (POST chat/sends/close).

export const STOP_WAITS_MS: readonly number[] = [250, 450, 700, 1000];
export const STOP_LIMIT_MS = 3500;
export const STOP_ASK_LIMIT_MS = 2000;

// 'saved'   the chat holds the turn: read it again for the real reply and price
// 'unsaved' the reply was charged but its messages could not be stored
// 'nothing' no reply was kept and the credits came back, or the send was closed before any were taken
// 'pending' not settled when the tries ran out
export type StopOutcome = 'saved' | 'unsaved' | 'nothing' | 'pending';

export interface JobRead {
    readonly state?: string;
    readonly refunded?: boolean;
    readonly error_code?: string;
}

// The saved turn for one send: the question carrying this text and the reply after it, neither of which was on screen
// before the send. The chat read gives no job id, so this is how a turn is found.
export function findSavedTurn(messages: readonly ChatMessage[] | undefined, knownIds: ReadonlySet<string>, text: string): { user: ChatMessage; reply: ChatMessage } | null {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 2; i >= 0; i -= 1) {
        const user = list[i];
        const reply = list[i + 1];
        if (user.role === 'user' && reply.role === 'assistant' && user.content === text && !knownIds.has(user.id) && !knownIds.has(reply.id)) return { user, reply };
    }
    return null;
}

export interface SettleArgs {
    readonly jobId: string | null;
    readonly text: string;
    readonly knownIds: ReadonlySet<string>;
    readonly getThread: () => Promise<{ messages: ChatMessage[] }>;
    readonly getJob: (id: string) => Promise<JobRead>;
    readonly wait?: (ms: number) => Promise<void>;
    readonly waits?: readonly number[];
    readonly limitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function settleStoppedTurn({ limitMs = STOP_LIMIT_MS, ...args }: SettleArgs): Promise<StopOutcome> {
    const clock = { over: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<StopOutcome>((resolve) => {
        timer = setTimeout(() => resolve('pending'), limitMs);
    });
    try {
        return await Promise.race([lookForTurn(args, clock), limit]);
    } finally {
        clock.over = true;
        if (timer) clearTimeout(timer);
    }
}

async function lookForTurn({ jobId, text, knownIds, getThread, getJob, wait = sleep, waits = STOP_WAITS_MS }: Omit<SettleArgs, 'limitMs'>, clock: { over: boolean }): Promise<StopOutcome> {
    for (let i = 0; i < waits.length; i += 1) {
        await wait(waits[i]);
        if (clock.over) break;
        // A failed read is not an answer: the next try decides.
        let job: JobRead | null = null;
        if (jobId) {
            try {
                job = await getJob(jobId);
            } catch {
                job = null;
            }
        }
        if (clock.over) break;
        const state = job ? job.state : null;
        if (state === 'queued' || state === 'running') continue;
        // The server stores the messages in the same step that ends the job, so a finished job needs no look at the chat.
        if (state === 'succeeded') return job?.error_code === 'reply_not_saved' ? 'unsaved' : 'saved';
        // The refund is a second step after the job fails; until it lands the balance is not final.
        if (state === 'failed' && !job?.refunded && i < waits.length - 1) continue;
        let messages: ChatMessage[] | null = null;
        try {
            messages = (await getThread()).messages;
        } catch {
            messages = null;
        }
        if (!Array.isArray(messages)) continue;
        if (findSavedTurn(messages, knownIds, text)) return 'saved';
        if (state === 'failed') return 'nothing';
    }
    return 'pending';
}

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SEND_KEY_RE = /^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const makeSendKey = (uuid: string): string => `vx-${uuid.toLowerCase()}`;

export interface SendAnswer {
    readonly closed: boolean;
    readonly job: string | null;
}
const NO_ANSWER: SendAnswer = { closed: false, job: null };

// Asks the server about a send by its own key. `closed` is true only when the server says exactly that: the send made no
// job and none can now be made, so nothing was charged. A job id is taken only in the shape the server makes. Never
// throws and never waits past the limit; anything else (a refusal, a rate limit, a slow answer) is "nothing known".
export async function askStoppedSend({ key, closeSend, limitMs = STOP_ASK_LIMIT_MS }: { key: string | null; closeSend: (key: string) => Promise<unknown>; limitMs?: number }): Promise<SendAnswer> {
    if (typeof key !== 'string' || !key) return NO_ANSWER;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), limitMs);
    });
    try {
        const answer = (await Promise.race([closeSend(key), limit])) as Record<string, unknown> | null;
        if (!answer || typeof answer !== 'object') return NO_ANSWER;
        if (answer.closed === true) return Object.keys(answer).length === 1 ? { closed: true, job: null } : NO_ANSWER;
        return answer.closed === false && typeof answer.job_id === 'string' && JOB_ID_RE.test(answer.job_id) ? { closed: false, job: answer.job_id } : NO_ANSWER;
    } catch {
        return NO_ANSWER;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export interface ResolveDeps {
    readonly closeSend: (key: string) => Promise<unknown>;
    readonly getThread: () => Promise<{ messages: ChatMessage[] }>;
    readonly getJob: (id: string) => Promise<JobRead>;
    readonly wait?: (ms: number) => Promise<void>;
}

// What became of a send that was stopped or cut off. With a job id (the `start` event) the turn is looked for by it.
// Without one, the server is asked by the send's key first: closed means nothing was charged and none can be.
export async function resolveStoppedSend(deps: ResolveDeps, send: { key: string; jobId: string | null; text: string; knownIds: ReadonlySet<string> }): Promise<StopOutcome> {
    let jobId = send.jobId;
    if (!jobId) {
        const asked = await askStoppedSend({ key: send.key, closeSend: deps.closeSend });
        if (asked.closed) return 'nothing';
        jobId = asked.job;
    }
    return settleStoppedTurn({ jobId, text: send.text, knownIds: send.knownIds, getThread: deps.getThread, getJob: deps.getJob, wait: deps.wait });
}

// The words for each ending; they always say whether credits were used.
export function stopNoticeKey(outcome: StopOutcome): string {
    switch (outcome) {
        case 'saved':
            return 'chat.stop.saved';
        case 'unsaved':
            return 'chat.stop.unsaved';
        case 'nothing':
            return 'chat.stop.nothing';
        default:
            return 'chat.stop.pending';
    }
}
