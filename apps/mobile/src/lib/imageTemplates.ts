import { API_BASE } from './api';

// Image templates, read from the anonymous GET /api/templates?kind=image. Each carries the model id and the full prompt;
// the price is read from the live catalog in Create, which is where a required photo is attached.
export interface ImageTemplate {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly modelId: string;
    readonly prompt: string;
    readonly previewUrl: string | null;
    readonly previewAspect: number;
    readonly photoRequired: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

// The server sends site-relative pictures ("/showcase/..."); only those and https addresses are shown.
function previewUrl(v: unknown, base: string): string | null {
    const s = str(v);
    if (!s) return null;
    if (s.startsWith('https://')) return s;
    return s.startsWith('/') && !s.startsWith('//') ? `${base}${s}` : null;
}

// "3 / 4" -> 0.75; anything else is a square.
function aspect(v: unknown): number {
    const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(String(v ?? ''));
    const ratio = m ? Number(m[1]) / Number(m[2]) : NaN;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function parseImageTemplates(body: unknown, base: string = API_BASE): ImageTemplate[] {
    const list = (body as { templates?: unknown } | null)?.templates;
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw): ImageTemplate[] => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const id = str(r.id), name = str(r.name), category = str(r.category), modelId = str(r.modelId), prompt = str(r.prompt);
        if (!id || !name || !category || !modelId || !prompt) return [];
        return [{ id, name, category, modelId, prompt, previewUrl: previewUrl(r.previewImage, base), previewAspect: aspect(r.previewAspect), photoRequired: r.photoRequired === true }];
    });
}

export async function fetchImageTemplates(): Promise<ImageTemplate[]> {
    const response = await fetch(`${API_BASE}/api/templates?kind=image`);
    if (!response.ok) throw new Error('image_templates_unavailable');
    return parseImageTemplates(await response.json());
}

export const imageCategoriesOf = (list: readonly ImageTemplate[]): string[] => [...new Set(list.map(t => t.category))];

export function imageTemplatesIn(list: readonly ImageTemplate[], category: string, query: string): ImageTemplate[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(t => (category === 'ALL' || t.category === category)
        && words.every(w => `${t.name} ${t.category} ${t.prompt}`.toLowerCase().includes(w)));
}
