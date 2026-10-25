// Dependency-free on purpose: draftKey.ts (used by Cinema upload too) needs the media signature without pulling in the
// whole Publish composer and the native modules behind it.
export type MediaType = 'image' | 'video';
export interface PostMedia { readonly jobId?: string; readonly uploadId?: string; readonly mediaType: MediaType; }
export type MediaDraft = { readonly media?: readonly PostMedia[]; readonly jobId: string; readonly uploadId?: string; readonly mediaType: MediaType };
export const draftMedia = (draft: MediaDraft): readonly PostMedia[] => draft.media ?? [{ mediaType: draft.mediaType, ...(draft.uploadId ? { uploadId: draft.uploadId } : { jobId: draft.jobId }) }];
export function mediaSignature(draft: MediaDraft): unknown[] {
    const items = draftMedia(draft);
    const identities = items.map(item => [item.uploadId ? `upload:${item.uploadId}` : item.jobId, item.mediaType]);
    // Preserve saved one-file retry keys across an app upgrade.
    return items.length === 1 ? identities[0] : [identities, 'carousel'];
}
