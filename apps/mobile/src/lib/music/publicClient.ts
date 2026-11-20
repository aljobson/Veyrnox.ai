import { ApiError, type ApiClient } from '../api';
import { isRecord } from '../responseShapes';
import { blocksOff } from './blocksClient';
import type { PublicSession } from './publicSession';
import { isBlocked } from './validateBlocks';
import { isBestOf, isComments, isProfilePage, isSocial, isTrackPage, publicHandle, publicKey, publicSlug, publicText, publicUuid } from './validatePublic';
import { REACTIONS, REPORT_CATEGORIES, type BestOf, type Blocked, type Comments, type ProfilePage, type PublicRead, type PublicWrite, type Social, type TrackPage, type WriteReceipt } from './publicTypes';
const BASE = '/api/v1/music';
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bad = () => new ApiError(200, 'bad_response');
const check = (ok: boolean) => { if (!ok) throw new ApiError(400, 'invalid_request'); };
async function mirror<T>(api: ApiClient, session: PublicSession, path: string, valid: (v: unknown) => v is T): Promise<PublicRead<T>> {
    const { revision, account } = session.snapshot();
    try {
        const value = await api.request<unknown>(`${BASE}/explore/${path}`);
        if (revision !== session.snapshot().revision) throw new ApiError(409, 'stale_read');
        if (!valid(value)) throw bad();
        session.available(); return { state: 'on', data: value };
    } catch (error) {
        if (account === session.snapshot().account && blocksOff(error)) { session.unavailable(); return { state: 'off' }; }
        if (revision !== session.snapshot().revision) throw new ApiError(409, 'stale_read');
        if (error instanceof ApiError && error.status === 404 && error.code === 'not_found') return { state: 'gone' };
        throw error;
    }
}
export const getBestOf = (api: ApiClient, session: PublicSession) => mirror<BestOf>(api, session, 'best-of', isBestOf);
export async function getPublicTrack(api: ApiClient, session: PublicSession, slug: string): Promise<PublicRead<TrackPage | Blocked>> {
    check(publicSlug(slug));
    const read = () => mirror<TrackPage | Blocked>(api, session, `tracks/${encodeURIComponent(slug)}`, (v): v is TrackPage | Blocked => isBlocked(v) || isTrackPage(v, slug));
    try { return await read(); } catch (e) {
        // A malformed comment page can signal blocks being switched off. Revalidate once, without ever displaying it.
        if (!(e instanceof ApiError) || e.code !== 'bad_response') throw e;
        const result = await read();
        if (result.state !== 'on' || 'blocked' in result.data) return result;
        throw e;
    }
}
export function getPublicProfile(api: ApiClient, session: PublicSession, handle: string) {
    check(publicHandle(handle));
    return mirror<ProfilePage | Blocked>(api, session, `creators/${encodeURIComponent(handle)}`, (v): v is ProfilePage | Blocked => isBlocked(v) || isProfilePage(v));
}
export async function getSocial(api: ApiClient, target: { slug: string } | { handle: string }): Promise<Social> {
    const query = 'slug' in target ? `slug=${encodeURIComponent(target.slug)}` : `handle=${encodeURIComponent(target.handle)}`;
    check('slug' in target ? publicSlug(target.slug) : publicHandle(target.handle));
    const v = await api.request<unknown>(`${BASE}/social?${query}`);
    if (!isRecord(v) || !isSocial(v.social)) throw bad();
    return v.social;
}
export async function getComments(api: ApiClient, session: PublicSession, slug: string, before?: string): Promise<Comments> {
    check(publicSlug(slug) && (before === undefined || publicUuid(before)));
    const { revision, account } = session.snapshot();
    const revalidate = async () => {
        const page = await getPublicTrack(api, session, slug);
        if (page.state !== 'on') throw new ApiError(404, page.state === 'off' ? 'blocks_unavailable' : 'not_found');
        if ('blocked' in page.data) throw new ApiError(409, 'creator_blocked');
        if (revision !== session.snapshot().revision) throw new ApiError(409, 'stale_read');
    };
    await revalidate();
    const v = await api.request<unknown>(`${BASE}/comments?slug=${encodeURIComponent(slug)}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
        .catch(e => { if (account === session.snapshot().account && blocksOff(e)) session.unavailable(); throw e; });
    if (revision !== session.snapshot().revision) throw new ApiError(409, 'stale_read');
    // Validate the entire page AND revalidate the mirror after it, including malformed pages.
    const valid = isRecord(v) && isComments(v.comments);
    await revalidate();
    if (!valid || !isRecord(v) || !isComments(v.comments)) throw bad();
    return v.comments;
}
export async function writePublic(api: ApiClient, w: PublicWrite, key: string): Promise<WriteReceipt> {
    check(publicKey(key));
    let payload: Record<string, unknown>;
    if (w.kind === 'reaction') {
        check(publicSlug(w.slug) && (w.reaction === null || REACTIONS.includes(w.reaction)));
        payload = { slug: w.slug, reaction: w.reaction };
    } else if (w.kind === 'follow') {
        check(publicHandle(w.handle) && typeof w.following === 'boolean');
        payload = { handle: w.handle, following: w.following };
    } else if (w.kind === 'submit') {
        check(publicSlug(w.slug) && publicText(w.body, 1000, 1)
            && (w.parent_id === undefined || publicUuid(w.parent_id))
            && (w.at_seconds === undefined || Number.isFinite(w.at_seconds) && w.at_seconds >= 0 && w.at_seconds <= 600));
        payload = { action: w.kind, slug: w.slug, body: w.body.trim(), ...(w.parent_id === undefined ? {} : { parent_id: w.parent_id }),
            ...(w.at_seconds === undefined ? {} : { at_seconds: w.at_seconds }) };
    } else if (w.kind === 'withdraw') {
        check(publicUuid(w.comment_id)); payload = { action: w.kind, comment_id: w.comment_id };
    } else {
        check(REPORT_CATEGORIES.includes(w.category) && publicText(w.details, 500, 3)
            && (w.kind === 'report' ? publicUuid(w.comment_id) : publicSlug(w.slug)));
        payload = { action: w.kind, ...(w.kind === 'report' ? { comment_id: w.comment_id } : { slug: w.slug }), category: w.category, details: w.details.trim() };
    }
    const social = w.kind === 'reaction' || w.kind === 'follow';
    const v = await api.request<unknown>(`${BASE}/${social ? 'social' : 'comments'}`, json({ ...payload, idempotency_key: key }));
    if (!isRecord(v)) throw bad();
    if (social) {
        if (!isSocial(v.social) || typeof v.idempotent !== 'boolean') throw bad();
        return { social: v.social, idempotent: v.idempotent };
    }
    const status = w.kind === 'submit' ? 'pending' : w.kind === 'withdraw' ? 'withdrawn' : 'reported';
    if (v.status !== status) throw bad();
    if (w.kind === 'report_song') {
        if ('idempotent' in v && typeof v.idempotent !== 'boolean') throw bad();
        return { status: 'reported', ...(typeof v.idempotent === 'boolean' ? { idempotent: v.idempotent } : {}) };
    }
    if (!publicUuid(v.id) || typeof v.idempotent !== 'boolean') throw bad();
    return { id: v.id, status, idempotent: v.idempotent };
}
export const setReaction = (api: ApiClient, w: Extract<PublicWrite, { kind: 'reaction' }>, key: string) => writePublic(api, w, key);
export const setFollow = (api: ApiClient, w: Extract<PublicWrite, { kind: 'follow' }>, key: string) => writePublic(api, w, key);
export const submitComment = (api: ApiClient, w: Extract<PublicWrite, { kind: 'submit' }>, key: string) => writePublic(api, w, key);
export const withdrawComment = (api: ApiClient, id: string, key: string) => writePublic(api, { kind: 'withdraw', comment_id: id }, key);
export const reportComment = (api: ApiClient, w: Extract<PublicWrite, { kind: 'report' }>, key: string) => writePublic(api, w, key);
export const reportSong = (api: ApiClient, w: Extract<PublicWrite, { kind: 'report_song' }>, key: string) => writePublic(api, w, key);
export async function countPlay(api: ApiClient, slug: string, signal?: AbortSignal) {
    check(publicSlug(slug));
    const v = await api.request<unknown>(`${BASE}/comments`, { ...json({ action: 'count_play', slug }), ...(signal ? { signal } : {}) });
    if (!isRecord(v) || typeof v.counted !== 'boolean') throw bad();
    return v.counted;
}
