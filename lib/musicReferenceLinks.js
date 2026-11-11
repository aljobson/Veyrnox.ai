import { readBoundedBody } from './boundedBody.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SOUNDCLOUD_SLUG_RE = /^[A-Za-z0-9_-]{1,100}$/;
const SOUNDCLOUD_RESERVED_FIRST = new Set(['discover', 'search', 'stream', 'upload', 'you', 'settings']);
const SOUNDCLOUD_RESERVED_SECOND = new Set([
    'albums', 'comments', 'followers', 'following', 'likes', 'popular-tracks',
    'reposts', 'sets', 'spotlight', 'tracks',
]);
const OEMBED_MAX_BYTES = 64 * 1024;
const OEMBED_TIMEOUT_MS = 6_000;

export const MUSIC_REFERENCE_RIGHTS = Object.freeze(['inspiration', 'owned_or_licensed']);

function exactKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function youtubeId(url) {
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') {
        const segments = url.pathname.split('/').filter(Boolean);
        return segments.length === 1 ? segments[0] : '';
    }
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return '';
    if (url.pathname === '/watch') return url.searchParams.get('v') || '';
    const match = /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname);
    return match?.[1] || '';
}

export function normalizeMusicReferenceUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || raw.length > 1_000) return { ok: false, error: 'reference_url_invalid' };
    let url;
    try { url = new URL(raw); } catch { return { ok: false, error: 'reference_url_invalid' }; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        return { ok: false, error: 'reference_url_invalid' };
    }

    const id = youtubeId(url);
    if (id) {
        if (!YOUTUBE_ID_RE.test(id)) return { ok: false, error: 'reference_url_invalid' };
        return {
            ok: true,
            provider: 'youtube',
            externalId: id,
            canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        };
    }

    const host = url.hostname.toLowerCase();
    if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'm.soundcloud.com') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 2
            || segments.some((segment) => !SOUNDCLOUD_SLUG_RE.test(segment))
            || SOUNDCLOUD_RESERVED_FIRST.has(segments[0].toLowerCase())
            || SOUNDCLOUD_RESERVED_SECOND.has(segments[1].toLowerCase())) {
            return { ok: false, error: 'reference_url_invalid' };
        }
        const externalId = `${segments[0]}/${segments[1]}`.toLowerCase();
        return {
            ok: true,
            provider: 'soundcloud',
            externalId,
            canonicalUrl: `https://soundcloud.com/${externalId}`,
        };
    }

    return { ok: false, error: 'reference_provider_not_supported' };
}

export function parseMusicReferenceCreate(value) {
    const keys = ['idempotency_key', 'rights_confirmed', 'rights_mode', 'url'];
    if (!exactKeys(value, keys)) return { ok: false, error: 'invalid_request' };
    const normalized = normalizeMusicReferenceUrl(value.url);
    if (!normalized.ok) return normalized;
    if (!MUSIC_REFERENCE_RIGHTS.includes(value.rights_mode)) {
        return { ok: false, error: 'reference_rights_invalid' };
    }
    if (typeof value.rights_confirmed !== 'boolean'
        || (value.rights_mode === 'owned_or_licensed' && value.rights_confirmed !== true)) {
        return { ok: false, error: 'rights_confirmation_required' };
    }
    if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(value.idempotency_key)) {
        return { ok: false, error: 'idempotency_key_invalid' };
    }
    return {
        ok: true,
        ...normalized,
        rightsMode: value.rights_mode,
        idempotencyKey: value.idempotency_key,
    };
}

export function parseMusicReferenceDelete(value) {
    if (!exactKeys(value, ['id']) || typeof value.id !== 'string' || !UUID_RE.test(value.id)) {
        return { ok: false, error: 'reference_id_invalid' };
    }
    return { ok: true, id: value.id.toLowerCase() };
}

function safeText(value, max) {
    const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    return text && text.length <= max ? text : '';
}

function safeThumbnail(value, provider) {
    if (!value) return null;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const allowed = provider === 'youtube'
            ? host === 'i.ytimg.com'
            : host === 'i1.sndcdn.com';
        return url.protocol === 'https:' && allowed && !url.username && !url.password ? url.toString() : null;
    } catch { return null; }
}

function soundCloudEmbed(html) {
    const match = /<iframe[^>]+src=["']([^"']+)["']/i.exec(typeof html === 'string' ? html : '');
    if (!match) return '';
    try {
        const decoded = match[1].replace(/&amp;|&#0*38;/gi, '&');
        const url = new URL(decoded);
        if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'w.soundcloud.com' || url.pathname !== '/player/') return '';
        const resource = new URL(url.searchParams.get('url') || '');
        const resourcePath = decodeURIComponent(resource.pathname);
        if (resource.protocol !== 'https:' || resource.hostname.toLowerCase() !== 'api.soundcloud.com'
            || !/^\/tracks\/(?:\d+|soundcloud:tracks:\d+)\/?$/.test(resourcePath)) return '';
        url.searchParams.set('auto_play', 'false');
        url.searchParams.set('show_artwork', 'true');
        return url.toString().slice(0, 1_000);
    } catch { return ''; }
}

function oEmbedUrl(reference) {
    if (reference.provider === 'youtube') {
        const endpoint = new URL('https://www.youtube.com/oembed');
        endpoint.searchParams.set('url', reference.canonicalUrl);
        endpoint.searchParams.set('format', 'json');
        return endpoint.toString();
    }
    const endpoint = new URL('https://soundcloud.com/oembed');
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('url', reference.canonicalUrl);
    endpoint.searchParams.set('maxheight', '450');
    endpoint.searchParams.set('auto_play', 'false');
    endpoint.searchParams.set('show_comments', 'false');
    return endpoint.toString();
}

function discardResponseBody(response) {
    try { void response.body?.cancel().catch(() => {}); } catch { /* already consumed or unavailable */ }
}

export async function resolveMusicReference(reference, { fetchImpl = fetch, signal, timeoutMs = OEMBED_TIMEOUT_MS } = {}) {
    if (!reference?.ok || !['youtube', 'soundcloud'].includes(reference.provider)) {
        return { ok: false, error: 'reference_url_invalid' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    const abort = () => controller.abort(signal?.reason || new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    try {
        const response = await fetchImpl(oEmbedUrl(reference), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: controller.signal,
        });
        if ([400, 404, 410].includes(response.status)) {
            discardResponseBody(response); return { ok: false, error: 'reference_not_found' };
        }
        if ([401, 403].includes(response.status)) {
            discardResponseBody(response); return { ok: false, error: 'reference_not_embeddable' };
        }
        if (response.status === 429) {
            discardResponseBody(response); return { ok: false, error: 'reference_upstream_rate_limited' };
        }
        if (!response.ok) {
            discardResponseBody(response); return { ok: false, error: 'reference_upstream_unavailable' };
        }
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > OEMBED_MAX_BYTES) {
            discardResponseBody(response);
            return { ok: false, error: 'reference_metadata_invalid' };
        }
        const type = response.headers.get('content-type') || '';
        if (!type.toLowerCase().includes('application/json')) {
            discardResponseBody(response);
            return { ok: false, error: 'reference_metadata_invalid' };
        }
        let payload;
        try {
            const bytes = await readBoundedBody(response.body, OEMBED_MAX_BYTES, controller.signal);
            payload = JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) {
            if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
            return { ok: false, error: 'reference_metadata_invalid' };
        }
        const title = safeText(payload?.title, 200);
        const creator = safeText(payload?.author_name, 120);
        const providerName = safeText(payload?.provider_name, 40).toLowerCase();
        const providerMatches = reference.provider === 'youtube'
            ? providerName === 'youtube'
            : providerName === 'soundcloud';
        const embedUrl = reference.provider === 'youtube'
            ? `https://www.youtube-nocookie.com/embed/${reference.externalId}?autoplay=0&playsinline=1`
            : soundCloudEmbed(payload?.html);
        if (!title || !creator || !providerMatches || !embedUrl) {
            return { ok: false, error: 'reference_metadata_invalid' };
        }
        return {
            ok: true,
            provider: reference.provider,
            externalId: reference.externalId,
            canonicalUrl: reference.canonicalUrl,
            title,
            creator,
            thumbnailUrl: safeThumbnail(payload?.thumbnail_url, reference.provider),
            embedUrl,
        };
    } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
            return { ok: false, error: 'reference_upstream_timeout' };
        }
        return { ok: false, error: 'reference_upstream_unavailable' };
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}
