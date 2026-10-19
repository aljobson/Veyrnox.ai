import type { ApiClient } from './api';

// ADR-0161: publish queues. The composer reserves the next free slot of a queue, creates the post at that time, then
// confirms the slot. The queue routes answer 404 `queues_not_open` while the server flag is off; the composer then
// simply does not offer queues.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface QueueSlot {
    readonly weekday: number; // 1 = Monday .. 7 = Sunday
    readonly minute: number; // minutes after midnight in the queue's time zone
}

export interface PublishQueue {
    readonly id: string;
    readonly name: string;
    readonly timezone: string;
    readonly accountIds: string[];
    readonly enabled: boolean;
    readonly slots: QueueSlot[];
}

export function parseQueues(body: unknown): PublishQueue[] {
    const out: PublishQueue[] = [];
    for (const raw of list(isObject(body) ? body.queues : null)) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        if (!id || !name) continue;
        const slots: QueueSlot[] = [];
        for (const s of list(raw.slots)) {
            if (isObject(s) && Number.isInteger(s.weekday) && Number.isInteger(s.minute)) slots.push({ weekday: s.weekday as number, minute: s.minute as number });
        }
        out.push({ id, name, timezone: str(raw.timezone) ?? 'UTC', accountIds: list(raw.account_ids).filter((a): a is string => typeof a === 'string'), enabled: raw.enabled === true, slots });
    }
    return out;
}

export async function fetchQueues(api: ApiClient): Promise<PublishQueue[]> {
    return parseQueues(await api.request('/api/v1/social/queues'));
}

export interface SlotReservation {
    readonly assignmentId: string;
    readonly scheduledAt: Date;
    readonly accountIds: string[];
}

export async function reserveSlot(api: ApiClient, queueId: string, idempotencyKey: string): Promise<SlotReservation> {
    const r = await api.request<{ assignment_id?: unknown; scheduled_at?: unknown; account_ids?: unknown }>('/api/v1/social/queues/reserve', json('POST', { queueId, idempotencyKey }));
    const assignmentId = str(r.assignment_id);
    const at = typeof r.scheduled_at === 'string' ? new Date(r.scheduled_at) : null;
    if (!assignmentId || !at || Number.isNaN(at.getTime())) throw new Error('queue_reply_invalid');
    return { assignmentId, scheduledAt: at, accountIds: list(r.account_ids).filter((a): a is string => typeof a === 'string') };
}

export const confirmSlot = (api: ApiClient, assignmentId: string, postId: string) =>
    api.request('/api/v1/social/queues/reserve', json('PATCH', { assignmentId, postId }));

// The weekday names a queue's slots, e.g. "Mon 09:00". Time is in the queue's own time zone.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function slotLabel(s: QueueSlot): string {
    const h = String(Math.floor(s.minute / 60)).padStart(2, '0');
    const m = String(s.minute % 60).padStart(2, '0');
    return `${DAYS[s.weekday - 1] ?? '?'} ${h}:${m}`;
}

export function queueErrorKey(err: unknown): string {
    const e = err as { status?: number; code?: string } | null;
    const code = String(e?.code ?? '');
    if (e?.status === 0) return 'queue.err.network';
    if (e?.status === 402) return 'queue.err.plan';
    if (code === 'queues_not_open' || e?.status === 404) return 'queue.err.notOpen';
    if (code === 'no_queue_slot') return 'queue.err.noSlot';
    if (code === 'queue_disabled') return 'queue.err.disabled';
    if (e?.status === 429) return 'queue.err.rate';
    return 'queue.err.later';
}
