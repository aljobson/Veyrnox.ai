import { isUuid } from './validate.js';

const KEY_RE = /^[A-Za-z0-9._-]{8,120}$/;
const SLUG_RE = /^[a-f0-9]{24}$/;
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
const REPORT_CATEGORIES = new Set(['spam', 'abuse', 'privacy', 'rights', 'other']);
const ALBUM_TYPES = new Set(['album', 'ep', 'single']);

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, max, { required = false } = {}) => {
    if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return null;
    const clean = value.trim();
    return (!required || clean) && clean.length <= max ? clean : null;
};
const key = (value) => typeof value === 'string' && KEY_RE.test(value);
const revision = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const asset = (value) => value === null || isUuid(value || '');

export function parseAlbumCreate(value) {
    if (!exact(value, ['title', 'description', 'album_type', 'artwork_asset_id', 'idempotency_key'])) return { ok: false, error: 'invalid_request' };
    const title = text(value.title, 80, { required: true });
    const description = text(value.description, 500);
    if (title === null) return { ok: false, error: 'title_invalid' };
    if (description === null) return { ok: false, error: 'description_invalid' };
    if (!ALBUM_TYPES.has(value.album_type)) return { ok: false, error: 'album_type_invalid' };
    if (!asset(value.artwork_asset_id)) return { ok: false, error: 'artwork_invalid' };
    if (!key(value.idempotency_key)) return { ok: false, error: 'idempotency_key_invalid' };
    return { ok: true, title, description, albumType: value.album_type, artworkAssetId: value.artwork_asset_id?.toLowerCase() || null, idempotencyKey: value.idempotency_key };
}

export function parseAlbumConversion(value) {
    if (!exact(value, ['playlist_id', 'title', 'description', 'album_type', 'artwork_asset_id', 'idempotency_key'])) return { ok: false, error: 'invalid_request' };
    if (!isUuid(value.playlist_id || '')) return { ok: false, error: 'playlist_id_invalid' };
    const created = parseAlbumCreate({ title: value.title, description: value.description, album_type: value.album_type,
        artwork_asset_id: value.artwork_asset_id, idempotency_key: value.idempotency_key });
    if (!created.ok) return created;
    return { ...created, playlistId: value.playlist_id.toLowerCase() };
}

export function parseAlbumPatch(value) {
    const base = ['action', 'expected_revision', 'idempotency_key'];
    if (!value || typeof value !== 'object' || !revision(value.expected_revision) || !key(value.idempotency_key)) {
        return { ok: false, error: 'invalid_request' };
    }
    if (value.action === 'update') {
        if (!exact(value, [...base, 'title', 'description', 'album_type', 'artwork_asset_id'])) return { ok: false, error: 'invalid_request' };
        const created = parseAlbumCreate({ title: value.title, description: value.description, album_type: value.album_type, artwork_asset_id: value.artwork_asset_id, idempotency_key: value.idempotency_key });
        return created.ok ? { ...created, action: 'update', expectedRevision: value.expected_revision } : created;
    }
    if (value.action === 'replace') {
        if (!exact(value, [...base, 'publication_ids'])) return { ok: false, error: 'invalid_request' };
        if (!Array.isArray(value.publication_ids) || value.publication_ids.length > 50
            || new Set(value.publication_ids).size !== value.publication_ids.length
            || value.publication_ids.some((id) => !isUuid(id || ''))) return { ok: false, error: 'publication_ids_invalid' };
        return { ok: true, action: 'replace', expectedRevision: value.expected_revision,
            publicationIds: value.publication_ids.map((id) => id.toLowerCase()), idempotencyKey: value.idempotency_key };
    }
    if (['publish', 'unpublish', 'delete'].includes(value.action)) {
        if (!exact(value, base)) return { ok: false, error: 'invalid_request' };
        return { ok: true, action: value.action, expectedRevision: value.expected_revision, idempotencyKey: value.idempotency_key };
    }
    return { ok: false, error: 'invalid_request' };
}

export function parseAlbumReport(value) {
    if (!exact(value, ['category', 'details', 'idempotency_key'])) return { ok: false, error: 'invalid_request' };
    const details = text(value.details, 500, { required: true });
    if (!REPORT_CATEGORIES.has(value.category)) return { ok: false, error: 'category_invalid' };
    if (details === null || details.length < 3) return { ok: false, error: 'details_invalid' };
    if (!key(value.idempotency_key)) return { ok: false, error: 'idempotency_key_invalid' };
    return { ok: true, category: value.category, details, idempotencyKey: value.idempotency_key };
}

export function parseAlbumReportResolve(value) {
    if (!exact(value, ['action', 'id', 'decision', 'reason']) || value.action !== 'resolve_album_report'
        || !['resolve', 'takedown'].includes(value.decision)) return { ok: false, error: 'action_invalid' };
    if (!isUuid(value.id || '')) return { ok: false, error: 'id_invalid' };
    const reason = text(value.reason, 500, { required: true });
    if (reason === null || reason.length < 3) return { ok: false, error: 'reason_invalid' };
    return { ok: true, payload: { action: 'resolve_album_report', id: value.id.toLowerCase(), decision: value.decision, reason } };
}

export const validAlbumSlug = (value) => SLUG_RE.test(value || '');

export function publicMusicAlbum(value) {
    if (!value || typeof value !== 'object') return null;
    if (!isUuid(value.id || '') || !SLUG_RE.test(value.slug || '') || !ALBUM_TYPES.has(value.album_type)
        || !HANDLE_RE.test(value.handle || '') || !isUuid(value.creator_id || '')
        || typeof value.title !== 'string' || !value.title.trim() || /[\u0000-\u001f]/.test(value.title)
        || typeof value.description !== 'string' || /[\u0000-\u001f]/.test(value.description)
        || typeof value.published_at !== 'string' || value.published_at.length > 40) return null;
    const tracks = Array.isArray(value.tracks) ? value.tracks.slice(0, 50).map((track) => ({
        publication_id: track?.publication_id,
        slug: track?.slug,
        title: typeof track?.title === 'string' ? track.title.slice(0, 120) : '',
        position: track?.position,
        audio_url: SLUG_RE.test(track?.slug || '') ? `/api/music/public/${track.slug}/asset` : '',
    })).filter((track) => isUuid(track.publication_id || '') && SLUG_RE.test(track.slug || '') && track.title
        && Number.isSafeInteger(track.position) && track.position >= 1 && track.position <= 50 && track.audio_url) : [];
    return {
        id: value.id,
        slug: value.slug,
        title: typeof value.title === 'string' ? value.title.slice(0, 80) : '',
        album_type: value.album_type,
        ...(value.has_artwork === true ? { artwork_url: `/api/music/albums/${value.slug}/artwork` } : {}),
        description: typeof value.description === 'string' ? value.description.slice(0, 500) : '',
        handle: value.handle,
        display_name: typeof value.display_name === 'string' ? value.display_name.slice(0, 80) : undefined,
        creator_id: value.creator_id,
        published_at: value.published_at,
        has_artwork: value.has_artwork === true,
        tracks,
    };
}
