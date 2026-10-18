import type { ApiClient } from './api';
import { ApiError } from './api';

// Publish brands (ADR-0135). A person can belong to several brands (their own, or a client's) with a role in each.
// The server picks the person's own brand unless the request carries `x-publish-brand-id`; this file holds the choice,
// adds that header to Publish calls only, and reads the list of brands. The choice is kept in memory: it is not
// saved, so every launch starts on the person's own brand, and a stale or foreign id is cleared as soon as the list
// shows it is not theirs. The server stays the authority on who may see what (a wrong id is a 404, a wrong role 403).

export const BRAND_HEADER = 'x-publish-brand-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['owner', 'manager', 'editor', 'viewer', 'analyst'] as const;
export type BrandRole = (typeof ROLES)[number];
const LABEL_MAX = 60;

export interface Brand {
    readonly id: string;
    readonly label: string;
    readonly timezone: string | null;
    readonly role: BrandRole;
    readonly paid: boolean;
}

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseBrands(body: unknown): Brand[] {
    const list = rec(body)?.brands;
    if (!Array.isArray(list)) return [];
    const out: Brand[] = [];
    for (const raw of list) {
        const r = rec(raw);
        if (!r) continue;
        const id = typeof r.id === 'string' && UUID_RE.test(r.id) ? r.id : null;
        const role = ROLES.find((x) => x === r.role);
        if (!id || !role) continue;
        const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, LABEL_MAX) : 'Brand';
        out.push({ id, label, timezone: typeof r.timezone === 'string' ? r.timezone : null, role, paid: r.paid === true });
    }
    return out;
}

export const roleLabel = (role: string): string => (role ? role.charAt(0).toUpperCase() + role.slice(1) : '');

type Listener = () => void;
let selected: string | null = null;
const listeners = new Set<Listener>();

export const brandStore = {
    get: (): string | null => selected,
    set(id: string | null): void {
        const next = id !== null && UUID_RE.test(id) ? id : null;
        if (next === selected) return;
        selected = next;
        listeners.forEach((l) => l());
    },
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};

// Clears a choice the list does not contain (another account, a removed membership). Returns what is selected now.
export function reconcileBrand(brands: readonly Brand[]): string | null {
    const current = brandStore.get();
    if (current !== null && !brands.some((b) => b.id === current)) brandStore.set(null);
    return brandStore.get();
}

const PUBLISH_PREFIX = '/api/v1/social/';
const BRANDS_PATH = '/api/v1/social/brands';

// The same client, with the chosen brand added to Publish calls. The choice is read when each call is made.
export function withBrand(api: ApiClient): ApiClient {
    return {
        ...api,
        request<T>(path: string, init?: RequestInit): Promise<T> {
            const brand = brandStore.get();
            if (!brand || !path.startsWith(PUBLISH_PREFIX) || path === BRANDS_PATH) return api.request<T>(path, init);
            return api.request<T>(path, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), [BRAND_HEADER]: brand } });
        },
    };
}

// Teams not open yet (404) means the person has only their own brand: an empty list, not an error.
export async function fetchBrands(api: ApiClient): Promise<Brand[]> {
    try {
        return parseBrands(await api.request(BRANDS_PATH));
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
    }
}
