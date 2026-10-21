import * as Crypto from 'expo-crypto';
import { ApiError, type ApiClient } from './api';
import { CATEGORIES } from './cinemaBrowse';
import { isDefiniteRefusal } from './draftKey';

// Pinned to the web contract; cinemaDrafts.test.ts reads the source independently.
export const RIGHTS_VERSION = 'rights-2026-10-13';
export const CINEMA_POLICY_VERSION = 'cinema-safety-2026-10-13';
export const RIGHTS_TEXT = 'I own or hold the rights to everything in this title, including any real people, voices, music and footage, and I have declared its AI use truthfully.';
export const SAFETY_TEXT = 'This title contains no nudity, pornography, explicit sexual content, sexualised minors, non-consensual intimate imagery, sexual violence, or sexual deepfake of a real person. I have read the Cinema Content Policy.';
export const MALWARE_TEXT = 'I have not intentionally included malware, executable code, disguised files or links intended to compromise viewers or Veyrnox.';
export const CINEMA_RATINGS = [['ALL', 'All ages'], ['PG', 'Parental guidance'], ['12', '12+'], ['15', '15+'], ['18', '18+']] as const;
export const CINEMA_WARNING_CODES = [['violence', 'Violence'], ['graphic_violence', 'Graphic violence'], ['strong_language', 'Strong language'], ['sex_references', 'Sex references'], ['drugs', 'Drugs'], ['horror', 'Horror or threat'], ['self_harm', 'Self-harm or suicide'], ['discrimination', 'Discrimination'], ['flashing_images', 'Flashing images']] as const;
export const AI_DISCLOSURES = ['generated_video', 'generated_voice', 'generated_music', 'synthetic_people', 'face_replacement', 'cloned_voice', 'generated_script', 'manipulated_real_world_footage'] as const;
export const UPLOAD_CHUNK_BYTES = 5242880;
export const MAX_UPLOAD_BYTES = 2147483648;
export const DRAFT_TYPES = ['FILM', 'SHORT', 'TRAILER'] as const;
export interface DraftInput {
    content_type: string; title: string; synopsis: string; language: string; categories: string[]; ai_disclosures: string[];
}
export interface CreatorTitle extends DraftInput {
    id: string; revision: number; lifecycle_status: string; video_ready: boolean; review_note?: string | null;
}
export const emptyDraft = (): DraftInput => ({ content_type: 'FILM', title: '', synopsis: '', language: 'en', categories: [], ai_disclosures: [] });
export function draftBody(input: DraftInput) {
    const { content_type, synopsis, language, categories, ai_disclosures } = input;
    const title = input.title.trim();
    if (!DRAFT_TYPES.some(x => x === content_type) || [...title].length < 1 || [...title].length > 160 || [...synopsis].length > 2000
        || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language) || categories.length > 2 || new Set(categories).size !== categories.length
        || categories.some(x => !CATEGORIES.some(c => c.slug === x)) || new Set(ai_disclosures).size !== ai_disclosures.length
        || ai_disclosures.some(x => !AI_DISCLOSURES.some(d => d === x))) throw new ApiError(400, 'invalid_draft');
    return { content_type, parent_id: null, position: null, title, synopsis, language, ai_disclosures, categories };
}
export function submitBody(contentId: string, rating: string, warnings: string[]) {
    if (!CINEMA_RATINGS.some(([x]) => x === rating) || new Set(warnings).size !== warnings.length
        || warnings.some(x => !CINEMA_WARNING_CODES.some(([c]) => c === x))) throw new ApiError(400, 'invalid_submission');
    return { content_id: contentId, rights_version: RIGHTS_VERSION, policy_version: CINEMA_POLICY_VERSION,
        audience_rating: rating, content_warnings: warnings, safety_confirmed: true, malware_confirmed: true };
}
export const listTitles = (api: Pick<ApiClient, 'request'>) => api.request<{ content: CreatorTitle[] }>('/api/v1/cinema/content');
export function jsonWrite<T>(api: Pick<ApiClient, 'request'>, path: string, body: unknown, key: string, method = 'POST') {
    return api.request<T>(path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
// A retry of the same body retains its key until success or a definite refusal.
export function bodyKeys() {
    const keys = new Map<string, string>();
    return {
        for(body: unknown) { const s = JSON.stringify(body); if (!keys.has(s)) keys.set(s, Crypto.randomUUID()); return keys.get(s)!; },
        finish(body: unknown, error?: unknown) { if (!error || isDefiniteRefusal(error)) keys.delete(JSON.stringify(body)); },
    };
}
export function creatorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return 'cinemaUpload.error';
    if (error.status === 429) return 'cinemaUpload.rate';
    const messages: Record<string, string> = {
        creator_required: 'role', account_not_active: 'role', content_not_open: 'closed', uploads_not_open: 'unavailable',
        publishing_not_open: 'closed', revision_conflict: 'revision', invalid_draft: 'invalidDraft',
        video_not_ready: 'videoNotReady', category_required: 'categoryRequired', safety_checks_pending: 'checksPending',
        safety_checks_failed: 'checksFailed', already_submitted: 'alreadySubmitted', rights_version_required: 'declarationChanged',
        policy_version_required: 'declarationChanged', upload_safety_hold: 'paused', upload_exists: 'different',
        upload_busy: 'support', upload_needs_reconciliation: 'support', upload_not_allowed: 'closed',
        idempotency_conflict: 'keyConflict', upload_removed: 'removed', slow_connection: 'slow',
        invalid_video: 'invalidVideo', no_space: 'space', unreadable_video: 'unreadable', same_video_required: 'sameVideo',
    };
    return `cinemaUpload.${messages[error.code] ?? 'error'}`;
}
