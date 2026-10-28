import type { GenerationReference, SlotName } from './sources';

export interface CreativeSourceHandoff {
    readonly recipe: string;
    readonly modelId: string;
    readonly aspect?: '1:1' | '9:16' | '16:9';
    readonly followup?: 'generated-sound';
    readonly picks?: Readonly<Record<string, string>>;
    readonly uploaded: Partial<Record<SlotName, string | readonly string[]>>;
    readonly references?: readonly GenerationReference[];
    readonly fromLibrary: Partial<Record<SlotName, string | readonly string[]>>;
    // True only when the handing screen showed the source-rights statement and the person ticked it.
    readonly rightsConfirmed?: boolean;
}

interface Pending extends CreativeSourceHandoff {
    readonly createdAt: number;
}

const MAX_AGE_MS = 15 * 60 * 1000;
const pending = new Map<string, Pending>();

function token(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Uploaded storage keys stay in memory. Navigation receives only a short-lived,
// single-use opaque token, so a copied deep link cannot disclose or reuse a source.
export function stageCreativeSourceHandoff(value: CreativeSourceHandoff, now = Date.now()): string {
    for (const [key, item] of pending) {
        if (now - item.createdAt > MAX_AGE_MS) pending.delete(key);
    }
    const key = token();
    pending.set(key, {
        ...value,
        picks: value.picks ? { ...value.picks } : undefined,
        uploaded: copySlots(value.uploaded),
        references: value.references?.map(ref => ({ ...ref })),
        fromLibrary: copySlots(value.fromLibrary),
        createdAt: now,
    });
    return key;
}

export function consumeCreativeSourceHandoff(key: string | undefined, recipe: string | undefined, modelId: string, now = Date.now()): CreativeSourceHandoff | null {
    const value = readCreativeSourceHandoff(key, recipe, modelId, now);
    if (key) pending.delete(key);
    return value;
}

export function readCreativeSourceHandoff(key: string | undefined, recipe: string | undefined, modelId: string, now = Date.now()): CreativeSourceHandoff | null {
    if (!key) return null;
    const item = pending.get(key);
    if (!item) return null;
    if (now - item.createdAt > MAX_AGE_MS || item.recipe !== recipe || item.modelId !== modelId) {
        pending.delete(key);
        return null;
    }
    return {
        recipe: item.recipe,
        modelId: item.modelId,
        aspect: item.aspect,
        followup: item.followup,
        picks: item.picks ? { ...item.picks } : undefined,
        uploaded: copySlots(item.uploaded),
        references: item.references?.map(ref => ({ ...ref })),
        fromLibrary: copySlots(item.fromLibrary),
        rightsConfirmed: item.rightsConfirmed === true,
    };
}

function copySlots(value: CreativeSourceHandoff["uploaded"]): CreativeSourceHandoff["uploaded"] {
    return Object.fromEntries(Object.entries(value).map(([slot, keys]) => [slot, Array.isArray(keys) ? [...keys] : keys]));
}
