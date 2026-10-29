import { STYLE_MAX, textStyleProblem } from './brandKitStyles';
import { t } from './i18n';
import { ApiError, type ApiClient, type CallOptions } from './api';

// Parity P7 amended by ADR-0299: phone drafts edit styles and attachments; removal only detaches.
// GET/PUT brand-kit and GET brand-assets remain gated by EDITOR_SHARED_TOOLS_ENABLED.
export const FONTS = ['sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Impact'] as const;
export const NAME_MAX = 80;
export const PALETTE_MAX = 12;
export const FONTS_MAX = 10;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVE_LIMIT_BYTES = 8192;

export interface Kit {
    readonly schemaVersion: 1;
    readonly name: string;
    readonly palette: readonly string[];
    readonly fonts: readonly string[];
    readonly textStyles: readonly unknown[];
    readonly assets: readonly unknown[];
}

export interface KitState {
    readonly kit: Kit;
    readonly version: number;
    readonly canEdit: boolean;
}

export const emptyKit = (): Kit => ({ schemaVersion: 1, name: t('brandKit.mybrand'), palette: ['#32d6c5', '#ffffff', '#101827'], fonts: ['Arial'], textStyles: [], assets: [] });

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// The server returns { kit: null, version: 0 } before anything is saved; that reads as the starting kit.
export function parseKitState(body: unknown): KitState {
    const r = rec(body) ?? {};
    const k = rec(r.kit);
    const base = emptyKit();
    const kit: Kit = k
        ? {
              schemaVersion: 1,
              name: typeof k.name === 'string' && k.name.trim() ? k.name : base.name,
              palette: Array.isArray(k.palette) ? k.palette.filter((c): c is string => typeof c === 'string') : base.palette,
              fonts: Array.isArray(k.fonts) ? k.fonts.filter((f): f is string => typeof f === 'string') : base.fonts,
              textStyles: Array.isArray(k.textStyles) ? k.textStyles : [],
              assets: Array.isArray(k.assets) ? k.assets : [],
          }
        : base;
    const version = typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 0 ? r.version : 0;
    return { kit, version, canEdit: r.canEdit === true };
}

// Accepts "#abc", "ABCDEF" or "#AABBCC" and returns "#aabbcc", or null.
export function normaliseColour(input: string): string | null {
    let v = input.trim().toLowerCase();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    return HEX_RE.test(v) ? v : null;
}

export type KitProblem = 'name' | 'palette' | 'fonts' | 'size' | 'styles' | 'assets' | null;

export function kitProblem(kit: Kit): KitProblem {
    if (!kit.name.trim() || kit.name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(kit.name)) return 'name';
    if (kit.palette.length === 0 || kit.palette.length > PALETTE_MAX || kit.palette.some((c) => !HEX_RE.test(c))) return 'palette';
    if (kit.fonts.length === 0 || kit.fonts.length > FONTS_MAX || kit.fonts.some((f) => !(FONTS as readonly string[]).includes(f))) return 'fonts';
    if (new TextEncoder().encode(JSON.stringify(kit)).byteLength > SAVE_LIMIT_BYTES) return 'size';
    if (kit.textStyles.length > STYLE_MAX || kit.textStyles.some(s => textStyleProblem(s))) return 'styles';
    if (kit.assets.length > ASSET_MAX || kit.assets.some(a => assetProblem(a))) return 'assets';
    return null;
}

// A new idempotency key per save attempt that the person made; a retry of the same attempt reuses it.
export const newSaveKey = (): string => `brand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const enc = encodeURIComponent;

export async function fetchKit(api: Pick<ApiClient, 'request'>, workspaceId: string, call?: CallOptions): Promise<KitState> {
    if (!UUID_RE.test(workspaceId)) throw new ApiError(400, 'invalid_workspace');
    return parseKitState(await api.request(`/api/v1/workspaces/${enc(workspaceId)}/brand-kit`, undefined, call));
}

export async function saveKit(api: Pick<ApiClient, 'request'>, workspaceId: string, state: KitState, kit: Kit, key: string, call?: CallOptions): Promise<KitState> {
    if (!UUID_RE.test(workspaceId)) throw new ApiError(400, 'invalid_workspace');
    if (kitProblem(kit)) throw new ApiError(400, 'invalid_brand_kit');
    return parseKitState(
        await api.request(`/api/v1/workspaces/${enc(workspaceId)}/brand-kit`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify({ expected_version: state.version, kit }),
        }, call),
    );
}

export interface BrandAsset {
    readonly id: string;
    readonly projectId: string;
    readonly type: string;
    readonly bytes: number | null;
    readonly seconds: number | null;
    readonly width: number | null;
    readonly height: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseAssets(body: unknown): { assets: BrandAsset[]; truncated: boolean } {
    const r = rec(body) ?? {};
    const list = Array.isArray(r.assets) ? r.assets : [];
    const assets: BrandAsset[] = [];
    for (const raw of list) {
        const a = rec(raw);
        if (!a || typeof a.id !== 'string' || typeof a.project_id !== 'string') continue;
        assets.push({
            id: a.id,
            projectId: a.project_id,
            type: typeof a.sniffed_type === 'string' ? a.sniffed_type : 'file',
            bytes: num(a.byte_size),
            seconds: num(a.duration_ms) === null ? null : Math.round((a.duration_ms as number) / 1000),
            width: num(a.width),
            height: num(a.height),
        });
    }
    return { assets, truncated: r.truncated === true };
}

export async function fetchBrandAssets(api: Pick<ApiClient, 'request'>, workspaceId: string, call?: CallOptions) {
    if (!UUID_RE.test(workspaceId)) throw new ApiError(400, 'invalid_workspace');
    return parseAssets(await api.request(`/api/v1/workspaces/${enc(workspaceId)}/brand-assets`, undefined, call));
}

export type KitErrorKey = 'brand.err.saveNotFound' | 'brand.err.off' | 'brand.err.conflict' | 'brand.err.rate' | 'brand.err.network' | 'brand.err.invalid' | 'brand.err.failed';

// Errors from these routes are { error: { code, message } }, which the API client reports with the code 'unknown':
// the wording follows the HTTP status.
export function kitErrorKey(err: unknown, phase?: 'read' | 'save'): KitErrorKey {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'brand.err.network';
        if (err.status === 404) return phase === 'save' ? 'brand.err.saveNotFound' : 'brand.err.off';
        if (err.status === 409) return 'brand.err.conflict';
        if (err.status === 429) return 'brand.err.rate';
        if (err.status === 400) return 'brand.err.invalid';
    }
    return 'brand.err.failed';
}

export const ASSET_MAX = 24;
export type KitAsset = { projectId: string; assetId: string; name: string; credit: string; usage: string; url: string };
export function assetProblem(v: unknown): 'name' | 'credit' | 'usage' | 'url' | 'shape' | null {
    const a = rec(v), keys = ['projectId', 'assetId', 'name', 'credit', 'usage', 'url'];
    if (!a || Object.keys(a).length !== keys.length || Object.keys(a).some(k => !keys.includes(k)) ||
        typeof a.projectId !== 'string' || !UUID_RE.test(a.projectId) || typeof a.assetId !== 'string' || !UUID_RE.test(a.assetId) ||
        ['name', 'credit', 'usage', 'url'].some(k => typeof a[k] !== 'string')) return 'shape';
    for (const [key, max] of [['name', 120], ['credit', 120], ['usage', 240], ['url', 1000]] as const) {
        const value = a[key] as string;
        if (value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (key === 'name' && !value.trim())) return key;
    }
    if (a.url !== '') {
        if (!/^https:\/\/[^/@\s]+([/?#]|$)/.test(a.url as string)) return 'url';
        try { const u = new URL(a.url as string); if (u.protocol !== 'https:' || u.username || u.password) return 'url'; }
        catch { return 'url'; }
    }
    return null;
}
export type AssetRow = { readonly key: string; readonly value: unknown };
export const toAssetRows = (assets: readonly unknown[], makeKey: () => string): AssetRow[] => assets.map(value => ({ key: makeKey(), value }));
export const assetsOf = (rows: readonly AssetRow[]): unknown[] => rows.map(r => r.value);
export const editAssetRow = (rows: readonly AssetRow[], key: string, patch: Partial<Pick<KitAsset, 'name' | 'credit' | 'usage' | 'url'>>): AssetRow[] =>
    rows.map(r => r.key === key && assetProblem(r.value) !== 'shape' ? { ...r, value: { ...(r.value as KitAsset), ...patch } } : r);
export const removeAssetRow = (rows: readonly AssetRow[], key: string): AssetRow[] => rows.filter(r => r.key !== key);
export function attachAsset(rows: readonly AssetRow[], entry: KitAsset, key: string): { next: AssetRow[]; outcome: 'added' | 'duplicate' | 'full' } {
    if (rows.some(r => rec(r.value)?.assetId === entry.assetId)) return { next: [...rows], outcome: 'duplicate' };
    if (rows.length >= ASSET_MAX) return { next: [...rows], outcome: 'full' };
    return { next: [...rows, { key, value: entry }], outcome: 'added' };
}
export const isAttachable = (a: BrandAsset): boolean => UUID_RE.test(a.id) && UUID_RE.test(a.projectId);
export const assetFromCatalog = (a: BrandAsset): KitAsset => ({ projectId: a.projectId, assetId: a.id, name: t('brand.assetDefault', { type: a.type, id: a.id.slice(0, 8) }), credit: '', usage: '', url: '' });

let assetKey = 0;
export const nextAssetKey = () => `asset-${++assetKey}`;
