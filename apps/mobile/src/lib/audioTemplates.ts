import { API_BASE } from './api';
import { previewUrl } from './imageTemplates';
import { internalModelIdOrNull } from './publicModelIds';

// Audio templates (music, voice-over, sound effects), read from the anonymous GET /api/templates?kind=audio.
// They carry a model id, a prompt and the licensed track's artwork and sample; the price is read from the live catalog in Create.
export interface AudioTemplate {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly modelId: string;
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly previewUrl: string | null;
    readonly previewAudioUrl: string | null;
    // The licensed track's credit line, shown with the sample as its licence asks.
    readonly attribution?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function parseAudioTemplates(body: unknown, base: string = API_BASE): AudioTemplate[] {
    const list = (body as { templates?: unknown } | null)?.templates;
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw): AudioTemplate[] => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const id = str(r.id), name = str(r.name), category = str(r.category), modelId = internalModelIdOrNull(str(r.modelId)), prompt = str(r.prompt);
        if (!id || !name || !category || !modelId || !prompt) return [];
        const negativePrompt = str(r.negativePrompt), attribution = str(r.previewAttribution);
        return [{ id, name, category, modelId, prompt, ...(negativePrompt ? { negativePrompt } : {}), ...(attribution ? { attribution } : {}), previewUrl: previewUrl(r.previewImage, base), previewAudioUrl: previewUrl(r.previewAudio, base) }];
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
