import type { CatalogModel } from './media';

// Mirrors lib/uploadSource.js and lib/generationSourceSlots.mjs on the server. The server
// judges every claim again; these checks only spare a person a failed upload.
const MB = 1024 * 1024;

export type SlotName = 'image' | 'endImage' | 'video' | 'audio';
export type SlotKind = 'image' | 'video' | 'audio';

const KIND: Record<SlotName, SlotKind> = { image: 'image', endImage: 'image', video: 'video', audio: 'audio' };
export const SLOT_ORDER: SlotName[] = ['image', 'endImage', 'video', 'audio'];

const ALLOWED: Record<string, { kind: SlotKind; maxBytes: number }> = {
    'image/jpeg': { kind: 'image', maxBytes: 20 * MB },
    'image/png': { kind: 'image', maxBytes: 20 * MB },
    'image/webp': { kind: 'image', maxBytes: 20 * MB },
    'video/mp4': { kind: 'video', maxBytes: 100 * MB },
    'audio/mpeg': { kind: 'audio', maxBytes: 20 * MB },
    'audio/wav': { kind: 'audio', maxBytes: 20 * MB },
};

const ALIASES: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'audio/mp3': 'audio/mpeg',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/vnd.wave': 'audio/wav',
};

export interface Slot {
    readonly slot: SlotName;
    readonly kind: SlotKind;
    readonly required: boolean;
    readonly label: string;
    readonly maxSeconds?: number;
    readonly maxPixels?: number;
}

export interface PickedFile {
    readonly uri: string;
    readonly mimeType?: string;
    readonly size?: number;
    readonly durationSeconds?: number;
}

export type PickedCheck = { readonly ok: true; readonly contentType: string } | { readonly ok: false; readonly error: 'type' | 'too_large' | 'size_unknown' | 'too_long' };

const DEFAULT_LABEL: Record<SlotName, string> = { image: 'Image', endImage: 'Last frame', video: 'Video', audio: 'Audio' };

// The file slots a model declares, in a fixed order, ignoring names the server does not know.
export function slotsFor(model: CatalogModel): Slot[] {
    const media = (model.capabilities?.media ?? {}) as Record<string, { required?: boolean; label?: string; maxSeconds?: number; maxPixels?: number }>;
    return SLOT_ORDER.filter((name) => Object.hasOwn(media, name)).map((name) => ({
        slot: name,
        kind: KIND[name],
        required: media[name].required === true,
        label: media[name].label ?? DEFAULT_LABEL[name],
        ...(typeof media[name].maxPixels === 'number' ? { maxPixels: media[name].maxPixels } : {}),
        ...(typeof media[name].maxSeconds === 'number' ? { maxSeconds: media[name].maxSeconds } : {}),
    }));
}

// Guided recipes name the exact primary slots they need. Do not accidentally
// turn another slot of the same kind (notably optional endImage) into a requirement.
export function requiredNamedSlots(model: CatalogModel, names: readonly SlotKind[]): Slot[] {
    const wanted = new Set<SlotKind>(names);
    return slotsFor(model)
        .filter((slot) => slot.slot !== 'endImage' && wanted.has(slot.slot))
        .map((slot) => ({ ...slot, required: true }));
}

export function checkPicked(kind: SlotKind, file: PickedFile, maxSeconds?: number): PickedCheck {
    const raw = (file.mimeType ?? '').trim().toLowerCase();
    const type = ALIASES[raw] ?? raw;
    const rule = Object.hasOwn(ALLOWED, type) ? ALLOWED[type] : undefined;
    if (!rule || rule.kind !== kind) return { ok: false, error: 'type' };
    if (!Number.isInteger(file.size) || (file.size as number) <= 0) return { ok: false, error: 'size_unknown' };
    if ((file.size as number) > rule.maxBytes) return { ok: false, error: 'too_large' };
    if (maxSeconds !== undefined && file.durationSeconds !== undefined && file.durationSeconds > maxSeconds) return { ok: false, error: 'too_long' };
    return { ok: true, contentType: type };
}

export function missingRequired(slots: readonly Slot[], uploaded: Partial<Record<SlotName, string>>): SlotName[] {
    return slots.filter((s) => s.required && !uploaded[s.slot]).map((s) => s.slot);
}

export function toSourceKeys(uploaded: Partial<Record<SlotName, string>>): { key: string; slot: SlotName }[] {
    return SLOT_ORDER.flatMap((slot) => (uploaded[slot] ? [{ key: uploaded[slot] as string, slot }] : []));
}

export function pickedProblem(error: Extract<PickedCheck, { ok: false }>['error'], kind: SlotKind): string {
    switch (error) {
        case 'type':
            return kind === 'image' ? 'Use a JPEG, PNG or WebP image.' : kind === 'video' ? 'Use an MP4 video.' : 'Use an MP3 or WAV file.';
        case 'too_large':
            return kind === 'video' ? 'That video is over 100 MB.' : 'That file is over 20 MB.';
        case 'too_long':
            return 'That file is longer than this model accepts.';
        default:
            return 'Could not read that file. Try another.';
    }
}
