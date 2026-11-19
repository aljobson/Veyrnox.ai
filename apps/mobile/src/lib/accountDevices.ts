import { ApiError, type ApiClient } from './api';

// Signed-in devices (ADR-0363): GET/DELETE /api/v1/account/sessions. Same shape as the web panel.
export interface DeviceRow {
    readonly id: string;
    readonly kind: 'app_ios' | 'app_android' | 'browser' | 'unknown';
    readonly browser: string | null;
    readonly system: string | null;
    readonly lastUsed: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['app_ios', 'app_android', 'browser', 'unknown'] as const;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function normaliseDevices(raw: unknown): DeviceRow[] {
    const rows = obj(raw).sessions;
    if (!Array.isArray(rows)) return [];
    const out: DeviceRow[] = [];
    for (const row of rows) {
        const r = obj(row);
        const device = obj(r.device);
        const id = text(r.id);
        if (!id || !UUID_RE.test(id)) continue;
        const kind = KINDS.find(k => k === device.kind) ?? 'unknown';
        out.push({ id, kind, browser: text(device.browser), system: text(device.system), lastUsed: text(r.last_used) });
    }
    return out;
}

// The session_id claim of our own access token marks "This device"; the server never trusts it.
export function sessionIdOf(accessToken: string | null | undefined): string {
    const part = accessToken?.split('.')[1];
    if (!part) return '';
    try {
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
        const id = (JSON.parse(json) as { session_id?: unknown }).session_id;
        return typeof id === 'string' ? id : '';
    } catch {
        return '';
    }
}

export async function listDevices(api: Pick<ApiClient, 'request'>): Promise<DeviceRow[]> {
    return normaliseDevices(await api.request<unknown>('/api/v1/account/sessions', { method: 'GET' }));
}

export async function endDevice(api: Pick<ApiClient, 'request'>, id: string): Promise<boolean> {
    try {
        await api.request('/api/v1/account/sessions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        return true;
    } catch (err) {
        if (err instanceof ApiError) return false;
        throw err;
    }
}
