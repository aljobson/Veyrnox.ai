import { ApiError, API_BASE } from './api';

// ADR-0120: the template gallery, read from the anonymous GET /api/presets. The price is the server's
// number for the template's own length; the app never computes one.
export interface Preset {
    readonly id: string;
    readonly title: string;
    readonly category: string;
    readonly modelId: string;
    readonly modelName: string;
    readonly prompt: string;
    readonly needs: string | null;
    readonly durationSeconds: number | null;
    readonly credits: number;
    readonly isNew: boolean;
    readonly previewUrl: string | null;
    readonly posterUrl: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const https = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://') ? v : null);

function parseOne(raw: unknown): Preset | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.gated === true) return null;
    const id = str(r.id);
    const title = str(r.title);
    const modelId = str(r.modelId);
    const prompt = str(r.prompt);
    if (!id || !title || !modelId || !prompt) return null;
    if (typeof r.credits !== 'number' || !Number.isInteger(r.credits) || r.credits <= 0) return null;
    return {
        id,
        title,
        category: str(r.category) ?? 'OTHER',
        modelId,
        modelName: str(r.modelName) ?? modelId,
        prompt,
        needs: str(r.needs),
        durationSeconds: typeof r.durationSeconds === 'number' && r.durationSeconds > 0 ? r.durationSeconds : null,
        credits: r.credits,
        isNew: r.isNew === true,
        previewUrl: https(r.previewUrl),
        posterUrl: https(r.posterUrl),
    };
}

export function parsePresets(body: unknown): Preset[] {
    const list = (body as { presets?: unknown } | null)?.presets;
    if (!Array.isArray(list)) return [];
    return list.map(parseOne).filter((p): p is Preset => p !== null);
}

export interface PresetGroup {
    readonly category: string;
    readonly items: Preset[];
}

export function groupByCategory(items: readonly Preset[]): PresetGroup[] {
    const groups = new Map<string, Preset[]>();
    for (const p of items) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return [...groups].map(([category, list]) => ({ category, items: list }));
}

export function presetPrice(p: Preset): string {
    return p.durationSeconds ? `${p.credits} credits · ${p.durationSeconds} s` : `${p.credits} credits`;
}

export async function fetchPresets(): Promise<Preset[]> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}/api/presets`);
    } catch {
        throw new ApiError(0, 'network');
    }
    if (!res.ok) throw new ApiError(res.status, 'presets_unavailable');
    return parsePresets(await res.json());
}
