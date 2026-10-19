import { ApiError, type ApiClient } from './api';

// ADR-0151: RSS autolists. A feed's new items become posts in a queue. The server checks the feed address, so the
// phone only requires https. Routes answer 404 `autolists_not_open` while the flag is off.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const INTERVALS = [30, 60, 180, 360, 720, 1440] as const;
export const NAME_MAX = 80;
export const TEMPLATE_MAX = 4000;
export const DEFAULT_TEMPLATE = '{{title}} {{link}}';

export interface AutolistItem {
    readonly id: string;
    readonly title: string;
    readonly status: string;
}
export interface Autolist {
    readonly id: string;
    readonly queueId: string;
    readonly queueName: string;
    readonly name: string;
    readonly feedUrl: string;
    readonly captionTemplate: string;
    readonly refreshIntervalMinutes: number;
    readonly enabled: boolean;
    readonly autoSchedule: boolean;
    readonly lastRefreshedAt: string | null;
    readonly lastError: string | null;
    readonly items: AutolistItem[];
}

export function parseAutolists(body: unknown): Autolist[] {
    const out: Autolist[] = [];
    for (const raw of list(isObject(body) ? body.autolists : null)) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const queueId = str(raw.queue_id);
        const name = str(raw.name);
        const feedUrl = str(raw.feed_url);
        if (!id || !queueId || !name || !feedUrl) continue;
        const items: AutolistItem[] = [];
        for (const i of list(raw.items)) if (isObject(i) && str(i.id)) items.push({ id: i.id as string, title: str(i.title) ?? '', status: str(i.status) ?? '' });
        out.push({
            id, queueId, name, feedUrl,
            queueName: str(raw.queue_name) ?? '',
            captionTemplate: typeof raw.caption_template === 'string' ? raw.caption_template : DEFAULT_TEMPLATE,
            refreshIntervalMinutes: typeof raw.refresh_interval_minutes === 'number' ? raw.refresh_interval_minutes : 360,
            enabled: raw.enabled === true,
            autoSchedule: raw.auto_schedule === true,
            lastRefreshedAt: str(raw.last_refreshed_at),
            lastError: str(raw.last_error),
            items,
        });
    }
    return out;
}

export const fetchAutolists = async (api: ApiClient) => parseAutolists(await api.request('/api/v1/social/autolists'));

export interface AutolistInput {
    readonly id: string | null;
    readonly queueId: string;
    readonly name: string;
    readonly feedUrl: string;
    readonly captionTemplate: string;
    readonly refreshIntervalMinutes: number;
    readonly enabled: boolean;
    readonly autoSchedule: boolean;
}

// The only placeholders the server accepts are {{title}}, {{link}} and {{summary}}.
export function templateValid(template: string): boolean {
    const t = template.trim();
    if (t.length < 1 || t.length > TEMPLATE_MAX) return false;
    return !/\{\{[^}]+\}\}/.test(t.replaceAll('{{title}}', '').replaceAll('{{link}}', '').replaceAll('{{summary}}', ''));
}

// A key into the catalog for what is wrong, or null.
export function validateAutolist(i: AutolistInput): string | null {
    if (!i.name.trim() || i.name.trim().length > NAME_MAX) return 'autolists.err.name';
    if (!/^https:\/\/[^\s/]+\S*$/i.test(i.feedUrl.trim())) return 'autolists.err.feed';
    if (!i.queueId) return 'autolists.err.queue';
    if (!templateValid(i.captionTemplate)) return 'autolists.err.template';
    if (!(INTERVALS as readonly number[]).includes(i.refreshIntervalMinutes)) return 'autolists.err.interval';
    return null;
}

export const saveAutolist = (api: ApiClient, i: AutolistInput) =>
    api.request<{ autolist_id?: string }>('/api/v1/social/autolists', json('PUT', { ...i, name: i.name.trim(), feedUrl: i.feedUrl.trim(), captionTemplate: i.captionTemplate.trim() }));

export const deleteAutolist = (api: ApiClient, id: string) => api.request(`/api/v1/social/autolists?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export function autolistErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    const code = err.code;
    if (err.status === 0) return 'autolists.err.network';
    if (err.status === 402) return 'autolists.err.plan';
    if (err.status === 403) return 'autolists.err.role';
    if (code === 'autolists_not_open') return 'autolists.err.notOpen';
    if (code === 'autolist_name_taken') return 'autolists.err.taken';
    if (code === 'autolist_limit') return 'autolists.err.limit';
    if (err.status === 404) return 'autolists.err.gone';
    if (err.status === 429) return 'autolists.err.rate';
    if (err.status === 400) return 'autolists.err.invalid';
    return 'autolists.err.later';
}
