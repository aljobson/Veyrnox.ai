import { ApiError, type ApiClient } from './api';
import { creatorMessage, draftBody, type CreatorTitle, type DraftInput } from './cinemaDrafts';
import { isUuid } from './cinemaSocial';
import { toBase64 } from './oddlingsPuppet';

export const ROOT_TYPES = ['SERIES', 'FILM', 'SHORT', 'TRAILER'] as const;
export const VIDEO_TYPES = ['FILM', 'SHORT', 'TRAILER', 'EPISODE'] as const;
export interface StudioTitle extends CreatorTitle { position?: number | null; parent_id?: string | null }
export const childType = (type: string | null) => type === 'SERIES' ? 'SEASON' : type === 'SEASON' ? 'EPISODE' : null;
export const parentTypeOf = (type: string) => type === 'SEASON' ? 'SERIES' : type === 'EPISODE' ? 'SEASON' : null;
export function listContent(api: Pick<ApiClient, 'request'>, parentId?: string) {
    if (parentId !== undefined && !isUuid(parentId)) throw new ApiError(400, 'invalid_query');
    return api.request<{ content: StudioTitle[] }>(`/api/v1/cinema/content${parentId === undefined ? '' : `?parent_id=${encodeURIComponent(parentId)}`}`);
}
export function nextPosition(items: { position?: number | null }[]) {
    const next = Math.max(0, ...items.map(item => item.position ?? 0)) + 1;
    if (!Number.isInteger(next) || next > 10000) throw new ApiError(400, 'invalid_draft');
    return next;
}
export function studioDraftBody(input: DraftInput, context: { parentId: string | null; parentType: string | null; position: number | null }) {
    const { parentId, parentType, position } = context;
    if (parentId === null && parentType === null && position === null && ROOT_TYPES.some(type => type === input.content_type)) {
        if (input.content_type !== 'SERIES') return draftBody(input);
        return { ...draftBody({ ...input, content_type: 'FILM' }), content_type: 'SERIES' };
    }
    if (!isUuid(parentId) || input.content_type !== childType(parentType) || !Number.isInteger(position)
        || position === null || position < 1 || position > 10000 || input.categories.length !== 0) throw new ApiError(400, 'invalid_draft');
    const valid = draftBody({ ...input, content_type: 'FILM' });
    return { content_type: input.content_type, parent_id: parentId, position, title: valid.title, synopsis: valid.synopsis, language: valid.language, ai_disclosures: valid.ai_disclosures };
}
export function withdrawBody(id: string, reason: string) {
    const trimmed = reason.trim();
    if (!isUuid(id) || [...trimmed].length < 3 || [...trimmed].length > 500) throw new ApiError(400, 'invalid_withdrawal');
    return { content_id: id, reason: trimmed };
}
export function importBody(contentId: string, jobId: string) {
    if (!isUuid(contentId) || !isUuid(jobId)) throw new ApiError(400, 'invalid_upload');
    return { content_id: contentId, job_id: jobId };
}
export async function fetchCreatorPoster(api: Pick<ApiClient, 'stream'>, id: string): Promise<string | null> {
    try {
        if (!isUuid(id)) return null;
        const response = await api.stream(`/api/v1/cinema/posters/${id}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
        if (!response.ok) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 5 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return null;
        return `data:image/jpeg;base64,${toBase64(bytes)}`;
    } catch { return null; }
}
export function studioMessage(error: unknown, { contentType }: { contentType?: string } = {}): string {
    if (error instanceof ApiError) {
        const messages: Record<string, string> = {
            position_taken: 'cinema.creatorWorkspace.thatNumberIsAlreadyInUse',
            draft_limit_reached: 'cinema.creatorWorkspace.youHaveReachedThePreviewDraft',
            not_withdrawable: 'cinema.creatorWorkspace.thisTitleCannotBeWithdrawnIn',
            already_published: 'cinema.creatorWorkspace.thisTitleIsAlreadyPublished',
            suspended: 'cinema.creatorWorkspace.thisTitleWasSuspendedByAn',
            content_not_found: 'cinema.creatorWorkspace.thatDraftIsNoLongerAvailable',
            no_episodes: 'cinema.creatorWorkspace.addAtLeastOneEpisodeTo',
            source_not_found: 'cinema.videoUpload.thatLibraryVideoIsNoLonger',
            source_not_video: 'cinema.videoUpload.chooseAFinishedVideoFromYour',
            upload_capacity_reached: 'cinema.videoUpload.thePreviewStorageOrDailyUpload',
            draft_locked: 'cinemaUpload.revision', structure_locked: 'cinemaUpload.revision', invalid_parent: 'cinemaUpload.revision',
        };
        if (error.code === 'video_not_ready' && contentType === 'SERIES') return 'cinema.creatorWorkspace.everyEpisodeOrTheFilmItself';
        if (messages[error.code]) return messages[error.code];
    }
    return creatorMessage(error);
}
