import type { Job } from './media';
import { kindOf, type CatalogModel } from './media';

// Image attachments for a chat reply (ADR-0068, ADR-0167). Up to four, each from the Library (the id of the job that made
// it, already in storage) or from the phone (uploaded first, before anything is charged).
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_EDGE = 2048;

export interface ChatImage {
    readonly video?: true;
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

// The same refs in the order the images are shown (ATT-06): the model is asked about "the first image" as the person sees it,
// so uploads are not grouped ahead of Library images. `uploadKeys` are the keys of the images with a local file, in order.
export function orderedAttachmentRefs(images: readonly ChatImage[], uploadKeys: readonly string[]): ({ source_key: string } | { source_asset: string })[] {
    let next = 0;
    return images.flatMap<AttachmentRef>((i) => (i.assetId ? [{ source_asset: i.assetId.toLowerCase() }] : i.uri ? [{ source_key: uploadKeys[next++] }] : []));
}

// A photo from the phone is redrawn before it leaves (chatResizer.ts): scaled to the long-edge cap (the server refuses more) and
// re-encoded as JPEG, which drops its EXIF block (camera, time, GPS position). Library images are already in storage and skip it.
export interface PreparedImage {
    readonly uri: string;
    readonly contentType: string;
    readonly size?: number;
}
export interface ImageResizer {
    prepare(image: { uri: string; width: number; height: number }, maxEdge: number): Promise<PreparedImage>;
}
export const RESIZE_UNAVAILABLE = 'resize_unavailable';

// The person's finished images, newest first, from a page of jobs and the catalog (which says what each model makes).
export function libraryImageJobs(jobs: readonly Job[], catalog: readonly Pick<CatalogModel, 'id' | 'modality'>[]): Job[] {
    const images = new Set(catalog.filter((m) => kindOf(m.modality) === 'image').map((m) => m.id));
    return jobs.filter((j) => j.state === 'succeeded' && j.has_asset && images.has(j.model_id));
}

// Images are chosen but the model in use cannot read them (no images offer). Sending then would drop them without a word and
// send the text alone, so Send waits until they are removed or a model that reads images is chosen.
export const imagesBlocked = (imageCount: number, imageExtra: number | null): boolean => imageCount > 0 && imageExtra === null;

// What the screen says after the photo picker returns. A cancelled pick says nothing; a photo that could not be read or
// prepared says so, even when others in the same pick were attached.
export function photoNoticeKey(problem: 'resize_unavailable' | 'failed' | null): string | null {
    if (problem === 'resize_unavailable') return 'chat.attach.needsUpdate';
    if (problem === 'failed') return 'chat.attach.photoFailed';
    return null;
}

export type AttachmentRef = { source_key: string } | { source_asset: string };
export interface SentRefs { readonly key: string; readonly refs: readonly AttachmentRef[] }

// The attachment refs for one send (ATT-REVIEW-05). A send whose outcome is not known yet keeps its idempotency key, and a
// retry of it must name the very same storage keys: uploading the photos again would mint new keys, the server would refuse
// the retry as a different request, and a further try could be charged twice. So the refs are kept with the send's key and
// reused while that key is reused; only a new send uploads.
export async function refsForSend(
    sendKey: string,
    kept: SentRefs | null,
    images: readonly ChatImage[],
    upload: (files: readonly ChatImage[]) => Promise<string[]>,
): Promise<SentRefs> {
    if (kept && kept.key === sendKey) return kept;
    const keys = await upload(images.filter((i) => !i.assetId && i.uri));
    return { key: sendKey, refs: orderedAttachmentRefs(images, keys) };
}
