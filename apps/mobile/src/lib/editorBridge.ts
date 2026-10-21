export const PROTOCOL = 1;
export const MEDIA_ID = /^j-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--(vocals|drums|bass|other|guitar|piano))?$/;
export interface ProjectDocument {
    readonly schema_version: 1 | 2 | 3;
    readonly project_id: string;
    readonly brief?: string;
    readonly canvas?: unknown;
    readonly timeline?: unknown;
}
export interface EngineImport { mediaId: string; kind: 'video' | 'audio' }
export type AssetError = 'unavailable' | 'expired' | 'offline' | 'rate_limited';
type Envelope = { v: 1 };
export type PageMessage = Envelope & (
    | { type: 'hello'; protocol: number; engine: { kind: 'stub' | 'web'; version: string }; caps: { secureContext: boolean; webcodecs: boolean; offscreenCanvas: boolean } }
    | { type: 'ready'; projectId: string }
    | { type: 'changed'; projectId: string; document: ProjectDocument }
    | { type: 'flushed'; nonce: string; projectId: string; document: ProjectDocument }
    | { type: 'asset-request'; reqId: string; mediaId: string }
    | { type: 'beat' }
    | { type: 'error'; code: 'load_failed' | 'invalid_document' | 'engine_unsupported' | 'internal' }
);
export type NativeMessage =
    | { type: 'init'; protocol: 1; locale: string }
    | { type: 'load'; projectId: string; revision: number; document: ProjectDocument; imports: EngineImport[] }
    | { type: 'flush'; nonce: string }
    | { type: 'saved'; revision: number }
    | { type: 'asset'; reqId: string; url: string; mime: string; expiresAt: number }
    | { type: 'asset-error'; reqId: string; code: AssetError };

export const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const shortId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(v);
// No TextEncoder dependency: Hermes and the tests count surrogate pairs identically.
export function utf8Bytes(text: string): number {
    let bytes = 0;
    for (const char of text) {
        const cp = char.codePointAt(0)!;
        bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    }
    return bytes;
}
export function validDocument(value: unknown, projectId: string): value is ProjectDocument {
    if (!isObject(value) || ![1, 2, 3].includes(value.schema_version as number) || value.project_id !== projectId) return false;
    if (!Object.keys(value).every(k => ['schema_version', 'project_id', 'brief', 'canvas', 'timeline'].includes(k))) return false;
    if (value.brief !== undefined && (typeof value.brief !== 'string' || value.brief.length > 6000)) return false;
    try { return utf8Bytes(JSON.stringify(value)) <= 32768; } catch { return false; }
}
// Stable across JSONB key reordering, used for snapshot identity, not for logging.
export function documentIdentity(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(documentIdentity).join(',')}]`;
    if (isObject(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${documentIdentity(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}
export function parsePageMessage(raw: string, url: string, baseOrigin: string, expectedProjectId: string): PageMessage | null {
    try {
        if (typeof raw !== 'string' || raw.length > 65536 || new URL(url).origin !== baseOrigin) return null;
        const m: unknown = JSON.parse(raw);
        if (!isObject(m) || m.v !== PROTOCOL) return null;
        switch (m.type) {
            case 'hello':
                if (!Number.isInteger(m.protocol) || Number(m.protocol) < 1 || Number(m.protocol) > 99 || !isObject(m.engine) || !isObject(m.caps)) return null;
                if (!['stub', 'web'].includes(String(m.engine.kind)) || typeof m.engine.version !== 'string' || !m.engine.version.length || m.engine.version.length > 40) return null;
                if (!['secureContext', 'webcodecs', 'offscreenCanvas'].every(k => typeof m.caps === 'object' && typeof (m.caps as Record<string, unknown>)[k] === 'boolean')) return null;
                break;
            case 'ready': if (m.projectId !== expectedProjectId) return null; break;
            case 'changed': case 'flushed':
                if (m.projectId !== expectedProjectId || !validDocument(m.document, expectedProjectId) || (m.type === 'flushed' && !shortId(m.nonce))) return null;
                break;
            case 'asset-request': if (!shortId(m.reqId) || typeof m.mediaId !== 'string' || !MEDIA_ID.test(m.mediaId)) return null; break;
            case 'beat': break;
            case 'error': if (!['load_failed', 'invalid_document', 'engine_unsupported', 'internal'].includes(String(m.code))) return null; break;
            default: return null;
        }
        return m as PageMessage;
    } catch { return null; }
}
export const nativeMessage = (msg: NativeMessage): string => JSON.stringify({ ...msg, v: PROTOCOL });
