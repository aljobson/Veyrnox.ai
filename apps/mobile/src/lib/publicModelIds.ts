// Mirror of lib/publicModelIds.js (the app cannot import from the repo root).
// The catalog API lists supplier-neutral ids; the app keeps working in catalog keys.
const TAG_SUPPLIER: Record<string, string> = { a1: 'kie', a2: 'grsai', a3: 'crun', a4: 'byteplus', a5: 'higgsfield', a6: 'openrouter', a7: 'fal' };

export function internalModelId(id: string): string {
    return id.replace(/-(a[1-7])$/, (_, tag: string) => `-${TAG_SUPPLIER[tag]}`);
}

/** Same, for a value that may be missing (a field read from an API answer). */
export function internalModelIdOrNull(id: string | null | undefined): string | null | undefined {
    return typeof id === 'string' ? internalModelId(id) : id;
}
