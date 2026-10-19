import type { ApiClient } from './api';

// ADR-0163: manage publish queues (list, save, delete). A queue is a set of accounts and weekly time slots; posts
// added to it take the next free slot. Routes answer 404 `queues_not_open` while the server flag is off.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface QueueSlot {
    readonly weekday: number; // 1 = Monday .. 7 = Sunday
    readonly minute: number; // minutes after midnight in the queue's time zone
}
export interface Queue {
    readonly id: string;
    readonly name: string;
    readonly timezone: string;
    readonly accountIds: string[];
    readonly enabled: boolean;
    readonly slots: QueueSlot[];
}

export function parseQueueList(body: unknown): Queue[] {
    const out: Queue[] = [];
    for (const raw of list(isObject(body) ? body.queues : null)) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        if (!id || !name) continue;
        const slots: QueueSlot[] = [];
        for (const s of list(raw.slots)) if (isObject(s) && Number.isInteger(s.weekday) && Number.isInteger(s.minute)) slots.push({ weekday: s.weekday as number, minute: s.minute as number });
        out.push({ id, name, timezone: str(raw.timezone) ?? 'UTC', accountIds: list(raw.account_ids).filter((a): a is string => typeof a === 'string'), enabled: raw.enabled === true, slots });
    }
    return out;
}

export const fetchQueueList = async (api: ApiClient) => parseQueueList(await api.request('/api/v1/social/queues'));

export const QUEUE_NAME_MAX = 80;
export const MAX_SLOTS = 35;
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface QueueInput {
    readonly id: string | null;
    readonly name: string;
    readonly timezone: string;
    readonly accountIds: readonly string[];
    readonly slots: readonly QueueSlot[];
    readonly enabled: boolean;
}

export const slotKey = (s: QueueSlot): string => `${s.weekday}:${s.minute}`;
export const slotText = (s: QueueSlot): string => `${DAYS[s.weekday - 1] ?? '?'} ${String(Math.floor(s.minute / 60)).padStart(2, '0')}:${String(s.minute % 60).padStart(2, '0')}`;

// "09:30" -> 570, or null.
export function parseMinute(text: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h < 24 && min < 60 ? h * 60 + min : null;
}

export const sortSlots = (slots: readonly QueueSlot[]): QueueSlot[] => [...slots].sort((a, b) => a.weekday - b.weekday || a.minute - b.minute);

// A key into the catalog for what is wrong, or null.
export function validateQueue(q: QueueInput): string | null {
    if (!q.name.trim() || q.name.trim().length > QUEUE_NAME_MAX) return 'queues.err.name';
    if (!q.timezone.trim() || q.timezone.length > 64) return 'queues.err.timezone';
    if (q.accountIds.length < 1 || q.accountIds.length > 20) return 'queues.err.accounts';
    if (q.slots.length < 1 || q.slots.length > MAX_SLOTS) return 'queues.err.slots';
    return null;
}

export const saveQueue = (api: ApiClient, q: QueueInput) =>
    api.request<{ queue_id?: string }>('/api/v1/social/queues', json('PUT', { id: q.id, name: q.name.trim(), timezone: q.timezone.trim(), accountIds: q.accountIds, slots: sortSlots(q.slots), enabled: q.enabled }));

export const deleteQueue = (api: ApiClient, id: string) => api.request(`/api/v1/social/queues?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export function queueAdminErrorKey(err: unknown): string {
    const e = err as { status?: number; code?: string } | null;
    const code = String(e?.code ?? '');
    if (e?.status === 0) return 'queues.err.network';
    if (e?.status === 402) return 'queues.err.plan';
    if (e?.status === 403) return 'queues.err.role';
    if (code === 'queues_not_open') return 'queues.err.notOpen';
    if (code === 'queue_name_taken') return 'queues.err.taken';
    if (code === 'queue_limit') return 'queues.err.limit';
    if (e?.status === 404) return 'queues.err.gone';
    if (e?.status === 429) return 'queues.err.rate';
    if (e?.status === 400) return 'queues.err.invalid';
    return 'queues.err.later';
}
