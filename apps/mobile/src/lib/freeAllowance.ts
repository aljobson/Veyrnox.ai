import type { ApiClient } from './api';

// ADR-0124: free generations left today, per model, from GET /api/v1/free-allowance (ADR-0069). The server decides
// what is free and how many are left; the app only shows it. Off, signed-out or any failure means no card.
export type FreeLeft = Readonly<Record<string, number>>;

export async function fetchFreeAllowance(api: Pick<ApiClient, 'request'>): Promise<FreeLeft> {
    const r = await api.request<{ enabled?: unknown; left?: unknown }>('/api/v1/free-allowance');
    if (r.enabled !== true || !r.left || typeof r.left !== 'object' || Array.isArray(r.left)) return {};
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(r.left as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[id] = n;
    }
    return out;
}

const MAX_LINES = 5;

// One line per catalog model that has free runs left; a model the catalog does not list is skipped.
export function freeLines(left: FreeLeft, models: readonly { readonly id: string; readonly name: string }[]): string[] {
    const lines: string[] = [];
    for (const m of models) {
        const n = left[m.id];
        if (n) lines.push(`${m.name}: ${n} free ${n === 1 ? 'run' : 'runs'} left today`);
    }
    return lines.slice(0, MAX_LINES);
}
