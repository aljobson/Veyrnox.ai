/**
 * Shared vocabulary for the Cinema implementation specification v1.0.
 * Database constraints remain authoritative. These definitions grant no role,
 * publication or playback permission and must never replace server checks.
 * Existing migration 0132 retains its lowercase, single-role membership model.
 * @typedef {'FILM'|'SERIES'|'SEASON'|'EPISODE'|'SHORT'|'TRAILER'|'PREMIERE'} ContentType
 * @typedef {'DRAFT'|'UPLOADING'|'PROCESSING'|'SCANNING'|'UNDER_REVIEW'|'APPROVED'|'SCHEDULED'|'PUBLISHED'|'REJECTED'|'SUSPENDED'|'COPYRIGHT_HOLD'|'AGE_RESTRICTED'|'GEO_RESTRICTED'|'ARCHIVED'|'DELETED'} ContentState
 * @typedef {'FREE'|'SUBSCRIPTION'|'CINEMA_PLUS'|'PPV'|'RENTAL'|'PURCHASE'|'SPONSORED'} MonetisationType
 * @typedef {'PRIVATE'|'UNLISTED'|'PUBLIC'} Visibility
 * @typedef {{id: string, creator_id: string, content_type: ContentType, title: string, slug: string, lifecycle_status: ContentState, visibility: Visibility, monetisation_type: MonetisationType}} CinemaContent
 */

export const CONTENT_TYPES = Object.freeze(['FILM', 'SERIES', 'SEASON', 'EPISODE', 'SHORT', 'TRAILER', 'PREMIERE']);
export const CONTENT_STATES = Object.freeze(['DRAFT', 'UPLOADING', 'PROCESSING', 'SCANNING', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'COPYRIGHT_HOLD', 'AGE_RESTRICTED', 'GEO_RESTRICTED', 'ARCHIVED', 'DELETED']);
export const MONETISATION_TYPES = Object.freeze(['FREE', 'SUBSCRIPTION', 'CINEMA_PLUS', 'PPV', 'RENTAL', 'PURCHASE', 'SPONSORED']);
export const AI_DISCLOSURES = Object.freeze(['generated_video', 'generated_voice', 'generated_music', 'synthetic_people', 'face_replacement', 'cloned_voice', 'generated_script', 'manipulated_real_world_footage']);
