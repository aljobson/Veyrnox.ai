import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from './api';
import { documentIdentity, isObject, utf8Bytes, validDocument, type ProjectDocument } from './editorBridge';
import { observe } from './network';

// The brief and canvas of a project document (ADR-0055), as the phone project screen edits them. No React here.
export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export const FRAME_RATES = [24, 25, 30, 60] as const;
export type Editable = { brief: string; aspectRatio: '16:9' | '9:16' | '1:1'; frameRate: 24 | 25 | 30 | 60 };
export interface Head { revision: number; document: ProjectDocument }
export const BRIEF_MAX = 6000;
export const DOCUMENT_MAX_BYTES = 32768;
// save_project_document refuses a 1,001st revision (migration 0361).
export const REVISION_CAP = 1000;

export type DocumentStatus = 'dropped' | 'unsupported' | 'offline' | 'conflict' | 'rejected' | 'revision_limit' | 'daily_limit' | 'paused' | 'unavailable' | 'failed';

export function readEditable(doc: ProjectDocument): Editable | null {
    const canvas = isObject(doc.canvas) ? doc.canvas : null;
    const aspect = canvas?.aspect_ratio, rate = canvas?.frame_rate;
    if (!ASPECT_RATIOS.includes(aspect as Editable['aspectRatio']) || !FRAME_RATES.includes(rate as Editable['frameRate'])) return null;
    return { brief: typeof doc.brief === 'string' ? doc.brief : '', aspectRatio: aspect as Editable['aspectRatio'], frameRate: rate as Editable['frameRate'] };
}

// A new document: only brief and canvas change; schema_version, project_id and any timeline are kept as they were.
export function applyEditable(doc: ProjectDocument, e: Editable): ProjectDocument {
    return { ...doc, brief: e.brief, canvas: { aspect_ratio: e.aspectRatio, frame_rate: e.frameRate } };
}

export const cleanBrief = (text: string): string => text.replace(/\u0000/g, '').slice(0, BRIEF_MAX);

export const documentProblem = (doc: ProjectDocument): 'too_big' | null => (utf8Bytes(JSON.stringify(doc)) > DOCUMENT_MAX_BYTES ? 'too_big' : null);

export interface Pending { body: string; key: string }
// The same body keeps its key, so a retried save is one revision; a changed body is a new save.
export function saveKeyFor(pending: Pending | null, body: string): Pending {
    return pending && pending.body === body ? pending : { body, key: randomUUID() };
}

// Project routes answer {error:{code,message}}; the API client reports those with the code 'unknown'.
export function serverCode(err: unknown): string | null {
    const body = err instanceof ApiError ? err.body : (err as { body?: unknown } | null)?.body;
    const error = isObject(body) ? body.error : null;
    return isObject(error) && typeof error.code === 'string' ? error.code : null;
}

export function documentStatus(err: unknown, expectedRevision: number): DocumentStatus {
    const status = (err as { status?: unknown } | null)?.status;
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'account_changed') return 'dropped';
    if (code === 'invalid_response') return 'unsupported';
    if (status === 0) return 'offline';
    if (status === 409) return 'conflict';
    if (status === 400) return 'rejected';
    if (status === 429) {
        if (serverCode(err) !== 'LIMIT_REACHED') return 'paused';
        return expectedRevision >= REVISION_CAP ? 'revision_limit' : 'daily_limit';
    }
    if (status === 401 || status === 403 || status === 404 || status === 503) return 'unavailable';
    return 'failed';
}

export interface VersionDocument { revision: number; document: ProjectDocument; createdAt: string | null }
export async function fetchVersion(api: ApiClient, id: string, revision: number): Promise<VersionDocument> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new ApiError(400, 'invalid_revision');
    const reply = await observe(api.request<Record<string, unknown>>(`/api/v1/projects/${encodeURIComponent(id)}/document?revision=${encodeURIComponent(String(revision))}`));
    if (!isObject(reply) || reply.revision !== revision || !validDocument(reply.document, id)) throw new ApiError(503, 'invalid_response');
    return { revision, document: reply.document, createdAt: typeof reply.created_at === 'string' ? reply.created_at : null };
}

export function parseRestored(reply: unknown, id: string, expectedRevision: number): Head | null {
    if (!isObject(reply) || !Number.isSafeInteger(reply.revision) || (reply.revision as number) <= expectedRevision) return null;
    return validDocument(reply.document, id) ? { revision: reply.revision as number, document: reply.document } : null;
}

export const isDirty = (head: Head, draft: Editable): boolean => documentIdentity(applyEditable(head.document, draft)) !== documentIdentity(head.document);
