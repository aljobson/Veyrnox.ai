import { ApiError, type ApiClient } from './api';
import { getCacheUser } from './appCache';
import { brandStore } from './publishBrand';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const plain = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : ''; // eslint-disable-line no-control-regex
export const presetScopeToken = () => JSON.stringify([getCacheUser() ?? null, brandStore.get()]);
export interface Preset { id: string; name: string; caption: string; accountIds: string[] }
export function parsePresets(body: unknown): Preset[] {
    const list = record(body).presets;
    return (Array.isArray(list) ? list : []).flatMap(raw => {
        const r = record(raw);
        if (typeof r.id !== 'string' || !UUID.test(r.id)) return [];
        return [{ id: r.id, name: plain(r.name, 80), caption: plain(r.caption, 4000),
            accountIds: Array.isArray(r.account_ids) ? [...new Set(r.account_ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))] : [] }];
    });
}
export const fetchPresets = async (api: ApiClient) => parsePresets(await api.request('/api/v1/social/presets'));
export function presetDraftProblem(name: string, caption: string, accountIds: readonly string[]): string | null {
    if (!name.trim() || name.trim().length > 80) return 'publishDepth.presets.nameRequired';
    if (!caption.trim() || caption.trim().length > 4000) return 'publishDepth.presets.captionRequired';
    if (accountIds.length > 20) return 'publishDepth.presets.accountsLimit';
    return null;
}
export const savePreset = (api: ApiClient, value: { id: string | null; name: string; caption: string; accountIds: string[] }) =>
    api.request('/api/v1/social/presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...value, name: value.name.trim(), caption: value.caption.trim(), accountIds: [...new Set(value.accountIds)] }) });
export const deletePreset = (api: ApiClient, id: string) => api.request(`/api/v1/social/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
export const applyPreset = (preset: Preset, eligibleIds: readonly string[]) => ({ text: preset.caption, accountIds: preset.accountIds.filter(id => eligibleIds.includes(id)) });
export function presetErrorKey(err: unknown): string {
    let key = 'failed';
    if (err instanceof ApiError) {
        if (err.status === 409 && err.code === 'preset_name_taken') key = 'exists';
        else if (err.status === 409 && err.code === 'preset_limit') key = 'limit';
        else if (err.status === 402) key = 'plan';
        else if (err.status === 403) key = 'role';
        else if (err.status === 404 && err.code === 'preset_not_found') key = 'gone';
        else if (err.status === 429) key = 'rate';
        else if (err.status === 0) key = 'network';
    }
    return `publishDepth.presets.${key}`;
}
