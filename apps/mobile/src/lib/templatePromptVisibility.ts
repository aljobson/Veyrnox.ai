import { kindOf } from './media';
import type { Preset } from './presets';

// Display only. A video template's words are still sent as before and still reach the phone in the template feed.
const PHOTO_LINE = 'The person in the attached photo is the main character; keep their face, hair and clothing the same throughout.';

export const isVideoPreset = (preset: Pick<Preset, 'modality'>): boolean => !preset.modality || kindOf(preset.modality) === 'video';

export function isOwnTemplatePrompt(preset: Pick<Preset, 'prompt' | 'sourcePrompt'>, prompt: string): boolean {
    return prompt.length > 0 && (prompt === preset.prompt || prompt === preset.sourcePrompt);
}

type SavedRun = {
    readonly request: { readonly analyticsKind?: unknown; readonly prompt?: unknown; readonly preset?: unknown; readonly templateId?: unknown };
    readonly carry?: unknown;
};

/** True only when the saved run provably used a video template's own words; an edited prompt stays visible. */
export function isUneditedVideoTemplateRun(saved: SavedRun, presets: readonly Preset[]): boolean {
    const { request } = saved;
    if (request.analyticsKind !== 'video') return false;
    if (typeof request.templateId === 'string' && request.templateId) return true;
    const carried = (saved.carry as { readonly tid?: unknown } | undefined)?.tid;
    const id = typeof request.preset === 'string' ? request.preset : carried;
    const preset = typeof id === 'string' ? presets.find(item => item.id === id) : undefined;
    const sent = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!preset || !sent || !isVideoPreset(preset)) return false;
    return [preset.prompt, preset.sourcePrompt].some(own => !!own && (sent === own.trim() || sent === `${own.trim()}\n\n${PHOTO_LINE}`));
}
