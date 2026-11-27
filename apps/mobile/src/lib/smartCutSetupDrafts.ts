import { getCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import type { SmartCutPacing } from './smartCut';

export interface SmartCutSetupClip {
    readonly jobId: string;
    readonly label: string;
    readonly length: number | null;
    readonly start: number;
    readonly end: number;
    readonly aspect?: number | null;
    readonly video_width?: number | null;
    readonly video_height?: number | null;
    readonly shape_ambiguous?: boolean;
}
export interface SmartCutSetupDraft {
    readonly owner: string;
    readonly updatedAt: number;
    readonly clips: readonly SmartCutSetupClip[];
    readonly script: string;
    readonly notes: string;
    readonly pacing: SmartCutPacing;
    readonly language: string;
    readonly removeFillers: boolean;
    readonly skippedFillers: readonly string[];
    readonly captionsOn: boolean;
    readonly captionPreset: string;
}

const key = (owner: string) => `smart-cut.setup.v1:${owner}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACING = new Set<SmartCutPacing>(['snappy', 'balanced', 'relaxed']);
const LANGUAGE = /^(auto|[a-z]{2,3}(?:-[A-Z]{2})?)$/;
const validNumber = (value: unknown, low: number, high: number) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const validClip = (clip: SmartCutSetupClip) => {
    const length = Number(clip?.length);
    return UUID.test(clip?.jobId) && typeof clip.label === 'string' && clip.label.length <= 120
    && validNumber(length, 0.1, 21_600) && validNumber(clip.start, 0, length) && validNumber(clip.end, clip.start, length)
    && clip.end > clip.start && (clip.aspect == null || validNumber(clip.aspect, 0.01, 100))
    && (clip.video_width == null || Number.isSafeInteger(clip.video_width) && clip.video_width > 0)
    && (clip.video_height == null || Number.isSafeInteger(clip.video_height) && clip.video_height > 0)
    && (clip.shape_ambiguous == null || typeof clip.shape_ambiguous === 'boolean');
};

export function validSmartCutSetupDraft(value: unknown, owner: string): value is SmartCutSetupDraft {
    const draft = value as SmartCutSetupDraft;
    return Boolean(draft && draft.owner === owner && Number.isSafeInteger(draft.updatedAt)
        && Array.isArray(draft.clips) && draft.clips.length > 0 && draft.clips.length <= 10 && draft.clips.every(validClip)
        && typeof draft.script === 'string' && draft.script.length <= 20_000
        && typeof draft.notes === 'string' && draft.notes.length <= 2_000
        && PACING.has(draft.pacing) && LANGUAGE.test(draft.language)
        && typeof draft.removeFillers === 'boolean' && Array.isArray(draft.skippedFillers) && draft.skippedFillers.length <= 500
        && draft.skippedFillers.every(item => typeof item === 'string' && item.length <= 180)
        && typeof draft.captionsOn === 'boolean' && typeof draft.captionPreset === 'string' && draft.captionPreset.length <= 80);
}

const safeDraft = (draft: SmartCutSetupDraft): SmartCutSetupDraft => ({
    owner: draft.owner, updatedAt: draft.updatedAt, clips: draft.clips.map(clip => ({ ...clip })),
    script: draft.script, notes: draft.notes, pacing: draft.pacing, language: draft.language,
    removeFillers: draft.removeFillers, skippedFillers: [...draft.skippedFillers],
    captionsOn: draft.captionsOn, captionPreset: draft.captionPreset,
});

export async function readSmartCutSetupDraft(owner: string, storage: CacheStorage = userDocStorage): Promise<SmartCutSetupDraft | null> {
    const raw = await storage.get(key(owner)).catch(() => null);
    if (!raw) return null;
    try {
        const value: unknown = JSON.parse(raw);
        if (validSmartCutSetupDraft(value, owner) && owner === getCacheUser()) return safeDraft(value);
    } catch { /* Invalid setup drafts are removed without logging their private text. */ }
    await storage.remove(key(owner)).catch(() => undefined);
    return null;
}

export async function writeSmartCutSetupDraft(draft: SmartCutSetupDraft, storage: CacheStorage = userDocStorage): Promise<boolean> {
    if (draft.owner !== getCacheUser() || !validSmartCutSetupDraft(draft, draft.owner)) return false;
    try {
        await storage.set(key(draft.owner), JSON.stringify(safeDraft(draft)));
        if (draft.owner !== getCacheUser()) { await storage.remove(key(draft.owner)); return false; }
        return true;
    } catch { return false; }
}

export const removeSmartCutSetupDraft = (owner: string, storage: CacheStorage = userDocStorage) => storage.remove(key(owner));
