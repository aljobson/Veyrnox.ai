import type { SlotName } from './sources';

export interface CreativeSourceHandoff {
    readonly recipe: string;
    readonly modelId: string;
    readonly aspect?: '1:1' | '9:16';
    readonly uploaded: Partial<Record<SlotName, string>>;
    readonly fromLibrary: Partial<Record<SlotName, string>>;
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
        uploaded: { ...value.uploaded },
        fromLibrary: { ...value.fromLibrary },
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
        uploaded: { ...item.uploaded },
        fromLibrary: { ...item.fromLibrary },
    };
}
