import { API_BASE } from './api';

// Audio templates (music, voice-over, sound effects), read from the anonymous GET /api/templates?kind=audio.
// They carry a model id and a prompt only; the price is read from the live catalog in Create.
export interface AudioTemplate {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly modelId: string;
    readonly prompt: string;
    readonly negativePrompt?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function parseAudioTemplates(body: unknown): AudioTemplate[] {
    const list = (body as { templates?: unknown } | null)?.templates;
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw): AudioTemplate[] => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const id = str(r.id), name = str(r.name), category = str(r.category), modelId = str(r.modelId), prompt = str(r.prompt);
        if (!id || !name || !category || !modelId || !prompt) return [];
        const negativePrompt = str(r.negativePrompt);
        return [{ id, name, category, modelId, prompt, ...(negativePrompt ? { negativePrompt } : {}) }];
    });
}

export async function fetchAudioTemplates(): Promise<AudioTemplate[]> {
    const response = await fetch(`${API_BASE}/api/templates?kind=audio`);
    if (!response.ok) throw new Error('audio_templates_unavailable');
    return parseAudioTemplates(await response.json());
}

export const audioCategoriesOf = (list: readonly AudioTemplate[]): string[] => [...new Set(list.map(t => t.category))];
export const audioTemplatesIn = (list: readonly AudioTemplate[], category: string): AudioTemplate[] =>
    category === 'ALL' ? [...list] : list.filter(t => t.category === category);
