import type { PassportDoc } from './oddlingsLibrary';

export const emptyDoc = (): PassportDoc => ({ items: [], draft: null });
export function isWellFormedText(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = s.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        } else if (c >= 0xdc00 && c <= 0xdfff) return false;
    }
    return true;
}
// Same separator-space algorithm as lib/projectOddlingsDocument.js.
export function jsonbTextBytes(value: unknown): number {
    const spaces = (v: unknown): number => v !== null && typeof v === 'object'
        ? (Array.isArray(v) ? 0 : Object.keys(v).length) + Math.max(0, Object.keys(v).length - 1)
            + Object.values(v).reduce<number>((sum, child) => sum + spaces(child), 0) : 0;
    return new TextEncoder().encode(JSON.stringify(value)).byteLength + spaces(value);
}
export function toServerDocument(projectId: string, doc: PassportDoc) {
    return { schema_version: 4 as const, project_id: projectId, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 },
        oddlings: { version: 1 as const, items: doc.items, draft: doc.draft } };
}
export type ServerDocument = ReturnType<typeof toServerDocument>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => object(v)
    && Object.keys(v).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(v, k));
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max;
const timestamp = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1e14;
const picks = (v: unknown) => object(v) && Object.keys(v).length <= 64
    && Object.entries(v).every(([k, s]) => /^[a-z_]{1,40}$/.test(k) && text(s, 1, 160));
const safeStrings = (v: unknown): boolean => typeof v === 'string' ? isWellFormedText(v) && !/[\u0000-\u001f]/.test(v)
    : v !== null && typeof v === 'object' ? Object.entries(v).every(([k, child]) => safeStrings(k) && safeStrings(child)) : true;
function valid(value: unknown): value is ServerDocument {
    if (!keys(value, ['schema_version', 'project_id', 'brief', 'canvas', 'oddlings']) || value.schema_version !== 4
        || typeof value.project_id !== 'string' || !text(value.brief, 0, 6000)
        || !keys(value.canvas, ['aspect_ratio', 'frame_rate']) || !['16:9', '9:16', '1:1'].includes(String(value.canvas.aspect_ratio))
        || ![24, 25, 30, 60].includes(value.canvas.frame_rate as number)) return false;
    const c = value.oddlings;
    return keys(c, ['version', 'items', 'draft']) && c.version === 1 && Array.isArray(c.items) && c.items.length <= 24
        && c.items.every(i => keys(i, ['id', 'savedAt', 'name', 'picks', 'motionId']) && text(i.id, 1, 80)
            && /^[A-Za-z0-9._-]+$/.test(i.id) && timestamp(i.savedAt) && text(i.name, 1, 40) && picks(i.picks)
            && text(i.motionId, 0, 40) && /^[a-z0-9-]*$/.test(i.motionId))
        && new Set(c.items.map(i => i.id)).size === c.items.length
        && (c.draft === null || (keys(c.draft, ['savedAt', 'picks']) && timestamp(c.draft.savedAt) && picks(c.draft.picks)))
        && safeStrings(value) && jsonbTextBytes(value) <= 32768;
}
export function fitsProject(doc: PassportDoc, projectId = '00000000-0000-0000-0000-000000000000'): boolean {
    return valid(toServerDocument(projectId, doc));
}
export function fromServerDocument(raw: unknown): { kind: 'oddlings'; doc: PassportDoc } | { kind: 'empty' } | { kind: 'other' } {
    if (!object(raw) || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) return { kind: 'other' };
    if (raw.revision === 0) return { kind: 'empty' };
    if (!valid(raw.document)) return { kind: 'other' };
    return { kind: 'oddlings', doc: { items: raw.document.oddlings.items, draft: raw.document.oddlings.draft } };
}
