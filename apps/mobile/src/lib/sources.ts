import { t } from './i18n';
import type { CatalogModel } from './media';

// Mirrors lib/uploadSource.js and lib/generationSourceSlots.mjs on the server. The server
// judges every claim again; these checks only spare a person a failed upload.
const MB = 1024 * 1024;

export type SlotName = 'image' | 'endImage' | 'video' | 'audio';
export type SlotKind = 'image' | 'video' | 'audio';

const KIND: Record<SlotName, SlotKind> = { image: 'image', endImage: 'image', video: 'video', audio: 'audio' };
// Per-slot ceiling; the model's verified limit decides, 3 stays the default (mirrors lib/multiReference.mjs).
export const MAX_SLOT_FILES = 9;
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
    readonly maxFiles?: number;
    readonly maxSeconds?: number;
    readonly minSeconds?: number;
    readonly minSide?: number;
    readonly maxSide?: number;
    readonly maxPixels?: number;
}

export interface PickedFile {
    readonly uri: string;
    readonly mimeType?: string;
    readonly size?: number;
    readonly durationSeconds?: number;
    readonly width?: number;
    readonly height?: number;
}

export type PickedCheck = { readonly ok: true; readonly contentType: string } | { readonly ok: false; readonly error: 'type' | 'too_large' | 'size_unknown' | 'too_long' | 'too_short' | 'resolution' };

const DEFAULT_LABEL: Record<SlotName, string> = { image: t('sources.image'), endImage: t('sources.lastframe'), video: t('sources.video'), audio: t('sources.audio') };

// The file slots a model declares, in a fixed order, ignoring names the server does not know.
/** At most 3 files a kind, unless one slot of the model is verified for more (Seedance reference: 9). */
export const kindCap = (slots: readonly Slot[], kind: SlotKind): number =>
    Math.max(3, ...slots.filter((s) => s.kind === kind).map((s) => s.maxFiles ?? 1));

export function slotsFor(model: CatalogModel): Slot[] {
    const media = model.capabilities?.media ?? {};
    return SLOT_ORDER.filter((name) => Object.hasOwn(media, name)).map((name) => ({
        slot: name,
        kind: KIND[name],
        maxFiles: Math.max(1, Math.min(MAX_SLOT_FILES, media[name].maxFiles ?? 1)),
        required: media[name].required === true,
        label: media[name].label ? slotLabel(media[name].label) : DEFAULT_LABEL[name],
        ...(typeof media[name].maxPixels === 'number' ? { maxPixels: media[name].maxPixels } : {}),
        ...(typeof media[name].maxSeconds === 'number' ? { maxSeconds: media[name].maxSeconds } : {}),
        ...(typeof media[name].minSeconds === 'number' ? { minSeconds: media[name].minSeconds } : {}),
        ...(typeof media[name].minSide === 'number' ? { minSide: media[name].minSide } : {}),
        ...(typeof media[name].maxSide === 'number' ? { maxSide: media[name].maxSide } : {}),
    }));
}

function slotLabel(label: string): string {
    const key = `label.${label}`, translated = t(key);
    return translated === key ? label : translated;
}

// Guided recipes name the exact primary slots they need. Do not accidentally
// turn another slot of the same kind (notably optional endImage) into a requirement.
export function requiredNamedSlots(model: CatalogModel, names: readonly SlotKind[]): Slot[] {
    const wanted = new Set<SlotKind>(names);
    return slotsFor(model)
        .filter((slot) => slot.slot !== 'endImage' && wanted.has(slot.slot))
        .map((slot) => ({ ...slot, required: true }));
}

// The media kind a picked file's MIME type belongs to, or null when the server takes none like it.
export function kindOfMime(mimeType: string | undefined): SlotKind | null {
    const raw = (mimeType ?? '').trim().toLowerCase();
    const type = ALIASES[raw] ?? raw;
    return Object.hasOwn(ALLOWED, type) ? ALLOWED[type].kind : null;
}

export function checkPicked(kind: SlotKind, file: PickedFile, limits: number | Pick<Slot, 'maxSeconds' | 'minSeconds' | 'minSide' | 'maxSide'> = {}): PickedCheck {
    const { maxSeconds, minSeconds, minSide, maxSide } = typeof limits === 'number' ? { maxSeconds: limits } : limits;
    const raw = (file.mimeType ?? '').trim().toLowerCase();
    const type = ALIASES[raw] ?? raw;
    const rule = Object.hasOwn(ALLOWED, type) ? ALLOWED[type] : undefined;
    if (!rule || rule.kind !== kind) return { ok: false, error: 'type' };
    if (!Number.isInteger(file.size) || (file.size as number) <= 0) return { ok: false, error: 'size_unknown' };
    if ((file.size as number) > rule.maxBytes) return { ok: false, error: 'too_large' };
    if (maxSeconds !== undefined && file.durationSeconds !== undefined && file.durationSeconds > maxSeconds) return { ok: false, error: 'too_long' };
    if (minSeconds !== undefined && Number.isFinite(file.durationSeconds) && (file.durationSeconds as number) > 0 && (file.durationSeconds as number) < minSeconds) return { ok: false, error: 'too_short' };
    // Expo reports zero dimensions when unavailable. Unknown metadata waits for server inspection.
    if (Number.isFinite(file.width) && Number.isFinite(file.height) && (file.width as number) > 0 && (file.height as number) > 0) {
        if ((minSide !== undefined && Math.min(file.width as number, file.height as number) < minSide)
            || (maxSide !== undefined && Math.max(file.width as number, file.height as number) > maxSide)) return { ok: false, error: 'resolution' };
    }
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
            return kind === 'image' ? t('sources.useaJPEGPNGorWebPimage') : kind === 'video' ? t('sources.useanMP4video') : t('sources.useanMP3orWAVfile');
        case 'too_large':
            return kind === 'video' ? t('sources.thatvideoisover100MB') : t('sources.thatfileisover20MB');
        case 'too_long':
            return t('sources.thatfileislongerthanthismodel');
        case 'too_short':
            return t('sourceLimits.tooShort');
        case 'resolution':
            return t('sourceLimits.resolution');
        default:
            return t('sources.couldnotreadthatfileTryanother');
    }
}

export type GenerationReference = { readonly slot: SlotName; readonly origin: 'upload'; readonly key: string } | { readonly slot: SlotName; readonly origin: 'asset'; readonly asset_id: string };
export function legacyReferences(uploaded: Partial<Record<SlotName, string | readonly string[]>>, assets: Partial<Record<SlotName, string | readonly string[]>>): GenerationReference[] {
    return SLOT_ORDER.flatMap(slot => [
        ...([uploaded[slot]].flat().filter(Boolean) as string[]).map(key => ({ slot, origin: 'upload' as const, key })),
        ...([assets[slot]].flat().filter(Boolean) as string[]).map(asset_id => ({ slot, origin: 'asset' as const, asset_id })),
    ]);
}
export function replaceSlotReferences(all: readonly GenerationReference[], slot: SlotName, files: readonly GenerationReference[]): GenerationReference[] {
    const first = all.findIndex(ref => ref.slot === slot), rest = all.filter(ref => ref.slot !== slot);
    rest.splice(first < 0 ? rest.length : first, 0, ...files);
    return rest;
}
