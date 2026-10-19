import type { Job } from './media';
import { kindOf, type CatalogModel } from './media';

// Image attachments for a chat reply (ADR-0068, ADR-0156). Up to four, each from the Library (the id of the job that made
// it, already in storage) or from the phone (uploaded first, before anything is charged).
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_EDGE = 2048;

export interface ChatImage {
    readonly id: string;
    // The job that made it (Library), or a local file to upload.
    readonly assetId?: string;
    readonly uri?: string;
    readonly width?: number;
    readonly height?: number;
    readonly preview?: string;
}

export const roomFor = (have: number, max: number = MAX_ATTACHMENTS): number => Math.max(0, max - have);

export function scaledSize(width: number, height: number, maxEdge: number = MAX_IMAGE_EDGE): { width: number; height: number } {
    const w = Math.max(1, Math.round(width) || 1);
    const h = Math.max(1, Math.round(height) || 1);
    const longest = Math.max(w, h);
    if (longest <= maxEdge) return { width: w, height: h };
    const k = maxEdge / longest;
    return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// The attachments field of the turn: an upload key, or one of the person's own finished Library images by job id. The
// server refuses more than four, a repeat, or any other shape.
export function attachmentRefs(uploadKeys: readonly string[], assetIds: readonly string[]): ({ source_key: string } | { source_asset: string })[] {
    return [...uploadKeys.map((k) => ({ source_key: k })), ...assetIds.map((id) => ({ source_asset: id.toLowerCase() }))];
}

// A photo from the phone must be redrawn before it leaves: scaled to the long-edge cap (the server refuses more) and
// re-encoded, which drops its EXIF block (camera, time, GPS position). The web does this on a canvas. On the phone it needs
// expo-image-manipulator, which is not installed, so until the owner approves that dependency the default resizer refuses and
// phone photos are not sent. Library images are already in storage and never pass through it.
export interface PreparedImage {
    readonly uri: string;
    readonly contentType: string;
    readonly size?: number;
}
export interface ImageResizer {
    prepare(image: { uri: string; width: number; height: number }, maxEdge: number): Promise<PreparedImage>;
}
export const RESIZE_UNAVAILABLE = 'resize_unavailable';
export const unavailableResizer: ImageResizer = {
    prepare: () => Promise.reject(new Error(RESIZE_UNAVAILABLE)),
};

// The person's finished images, newest first, from a page of jobs and the catalog (which says what each model makes).
export function libraryImageJobs(jobs: readonly Job[], catalog: readonly Pick<CatalogModel, 'id' | 'modality'>[]): Job[] {
    const images = new Set(catalog.filter((m) => kindOf(m.modality) === 'image').map((m) => m.id));
    return jobs.filter((j) => j.state === 'succeeded' && j.has_asset && images.has(j.model_id));
}
