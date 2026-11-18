import { getRandomBytes, randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { isRecord } from '../responseShapes';
import { isShareLink } from './validate';
import type { MusicShareLink } from './types';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PATH = /^\/listen\/[A-Za-z0-9_-]{43}$/;
export function newShareToken(): string {
    const bytes = getRandomBytes(32);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let token = '', buffer = 0, bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte; bits += 8;
        while (bits >= 6) { bits -= 6; token += alphabet[(buffer >>> bits) & 63]; }
    }
    if (bits) token += alphabet[(buffer << (6 - bits)) & 63];
    if (!TOKEN.test(token)) throw new Error('invalid_share_token');
    return token;
}
export function shareUrl(path: string): string {
    if (path.length !== 51 || !PATH.test(path)) throw new ApiError(200, 'bad_response');
    // Public origin confirmed in appLinks.ts/config.ts; never the dev/staging API origin.
    return `https://veyrnox.ai${path}`;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function listShareLinks(api: ApiClient, songId: string): Promise<readonly MusicShareLink[]> {
    const v = await api.request<unknown>(`/api/v1/music/songs/${encodeURIComponent(songId)}/share-links`);
    if (!isRecord(v) || !Array.isArray(v.links) || !v.links.every(isShareLink)) throw new ApiError(200, 'bad_response');
    return v.links;
}
export async function createShareLink(api: ApiClient, songId: string, versionId: string, token: string, idempotencyKey: string) {
    const v = await api.request<unknown>(`/api/v1/music/songs/${encodeURIComponent(songId)}/share-links`, json('POST', {
        version_id: versionId, token, idempotency_key: idempotencyKey,
    }));
    if (!isRecord(v) || !isRecord(v.link)) throw new ApiError(201, 'bad_response');
    const path = v.link.url;
    if (typeof path !== 'string' || !isShareLink(v.link) || v.link.version_id !== versionId
        || path !== `/listen/${token}`) throw new ApiError(201, 'bad_response');
    return { link: v.link, url: shareUrl(path) };
}
export async function revokeShareLink(api: ApiClient, linkId: string, idempotencyKey: string) {
    const v = await api.request<unknown>(`/api/v1/music/share-links/${encodeURIComponent(linkId)}`, json('DELETE', { idempotency_key: idempotencyKey }));
    // music_revoke_share_link returns only id/revoked_at, unlike list/create.
    if (!isRecord(v) || !isRecord(v.link) || typeof v.link.id !== 'string'
        || typeof v.link.revoked_at !== 'string' || typeof v.idempotent !== 'boolean') throw new ApiError(200, 'bad_response');
    return { link: { id: v.link.id, revoked_at: v.link.revoked_at }, idempotent: v.idempotent };
}
export type ShareAttempt = Readonly<{ songId: string; versionId: string; token: string; idempotencyKey: string }>;
// Kept in memory only. An ambiguous failure must not invent a different token for an existing key.
export function createShareAttempts(api: ApiClient, token = newShareToken, key = randomUUID) {
    let pending: ShareAttempt | null = null;
    let selected = '';
    return {
        select(versionId: string) { if (selected !== versionId) pending = null; selected = versionId; },
        async confirm(songId: string, versionId: string) {
            if (pending?.songId !== songId || pending.versionId !== versionId) {
                pending = Object.freeze({ songId, versionId, token: token(), idempotencyKey: key() });
            }
            selected = versionId;
            const attempt = pending;
            const result = await createShareLink(api, attempt.songId, attempt.versionId, attempt.token, attempt.idempotencyKey);
            if (pending === attempt) pending = null;
            return result;
        },
    };
}
