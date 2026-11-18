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

const SUPPLIER_TAG: Record<string, string> = { kie: 'a1', grsai: 'a2', crun: 'a3', byteplus: 'a4', higgsfield: 'a5', openrouter: 'a6', fal: 'a7' };
const WHOLESALE_NAME = /\s*\([^)]*\b(?:kie|fal|grsai|crun|higgsfield|byteplus|openrouter)\b[^)]*\)/gi;
const WHOLESALE_SUFFIX = /\s*(?:[·—-]|\bvia\b|\bthrough\b)\s*(?:kie|fal|grsai|crun|higgsfield|byteplus|openrouter)\b.*$/i;

/** Catalog key to its supplier-neutral public form. */
export function publicModelId(id: string): string {
    return id.replace(/-(kie|grsai|crun|byteplus|higgsfield|openrouter|fal)$/, (_, supplier: string) => `-${SUPPLIER_TAG[supplier]}`);
}

/** Mirror of publicModelName in lib/publicCatalog.js: a model name never shows the wholesale route. Older servers still send it. */
export function publicModelName(value: string): string {
    return value.replace(WHOLESALE_NAME, '').replace(WHOLESALE_SUFFIX, '').replace(/\s{2,}/g, ' ').trim();
}
