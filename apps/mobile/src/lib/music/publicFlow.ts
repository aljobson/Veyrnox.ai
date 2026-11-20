import { ApiError, type ApiClient } from '../api';
import { blocksOff, changeBlock } from './blocksClient';
import { createPublicAttempts, isDefinitivePublicError } from './publicAttempts';
import { getBestOf, getComments, getPublicProfile, getPublicTrack, getSocial } from './publicClient';
import type { PublicSession } from './publicSession';
import { creatorName } from './publicTypes';
import type { ApprovedComment, BestOf, Blocked, ProfilePage, PublicWrite, Social, TrackPage } from './publicTypes';
export type PublicTarget = { kind: 'explore' } | { kind: 'track'; slug: string; before?: string } | { kind: 'creator'; handle: string };
export type PublicData = BestOf | TrackPage | ProfilePage | Blocked;
export type PublicFlowState = { status: 'loading' | 'on' | 'off' | 'gone' | 'error'; data: PublicData | null;
    social: Social | null; refreshing: boolean; busy: boolean; error: unknown; notice: 'pending' | 'saved' | 'replyRemoved' | null;
    reply: ApprovedComment | null; retryAt: number };
export function createPublicFlow(api: ApiClient, session: PublicSession, target: PublicTarget) {
    let state: PublicFlowState = { status: 'loading', data: null, social: null, refreshing: false, busy: false, error: null, notice: null, reply: null, retryAt: 0 };
    let pageDepth = 1;
    const commentCursors = new Map<string, string | undefined>(), affectedBlocks = new Set<string>();
    function rememberComments(comments: ApprovedComment[], cursor?: string) { comments.forEach(c => commentCursors.set(c.id, cursor)); }
    let epoch = 0, disposed = false, focused = false, seen = session.snapshot();
    const attempts = createPublicAttempts(api), listeners = new Set<() => void>();
    const emit = (patch: Partial<PublicFlowState>) => { state = { ...state, ...patch }; if (!disposed) listeners.forEach(fn => fn()); };
    const valid = (ticket: number, revision: number) => !disposed && ticket === epoch && revision === session.snapshot().revision;
    function filter(data: PublicData | null): PublicData | null {
        if (!data || 'blocked' in data) return data;
        const creator = 'track' in data ? data.track : 'profile' in data ? data.profile : null;
        if (creator && session.blocked(creator.creator_id)) return { blocked: { creator_id: creator.creator_id, display_name: creatorName(creator) } };
        if ('playlists' in data) return { playlists: data.playlists.map(p => ({ ...p, tracks: p.tracks.filter(t => !session.blocked(t.creator_id)) })) };
        if ('track' in data) return { ...data,
            ...(data.comments ? { comments: { ...data.comments, comments: data.comments.comments.filter(c => !session.blocked(c.author_id)) } } : {}),
            ...(data.rails ? { rails: { by_creator: data.rails.by_creator.filter(t => !session.blocked(t.creator_id)), similar: data.rails.similar.filter(t => !session.blocked(t.creator_id)) } } : {}) };
        return data;
    }
    const unsubscribe = session.subscribe(() => {
        const next = session.snapshot();
        if (next.revision === seen.revision) return;
        const changedAccount = next.account !== seen.account;
        const added = next.blocks.filter(b => !seen.blocks.some(old => old.actor_id.toLowerCase() === b.actor_id.toLowerCase()));
        const removedBlocks = seen.blocks.filter(b => !next.blocks.some(now => now.actor_id.toLowerCase() === b.actor_id.toLowerCase()));
        const unblocked = new Set(removedBlocks.map(b => b.actor_id.toLowerCase()));
        if (next.change && next.change !== seen.change && !next.change.blocked) unblocked.add(next.change.actor_id.toLowerCase());
        const interrupted = state.refreshing;
        let affectedComments = false;
        // Unblock can restore rows/comments the server omitted before this screen mounted.
        let restore = unblocked.size > 0 && (target.kind === 'explore' || !!(state.data && 'track' in state.data && (state.data.comments || state.data.rails)));
        for (const b of added) {
            const id = b.actor_id.toLowerCase(), data = state.data;
            const matches = (actor: string) => actor.toLowerCase() === id;
            const comments = data && 'track' in data && data.comments?.comments.some(c => matches(c.author_id));
            affectedComments ||= !!comments;
            if (comments || (data && ('track' in data ? matches(data.track.creator_id) || [...(data.rails?.by_creator ?? []), ...(data.rails?.similar ?? [])].some(t => matches(t.creator_id))
                : 'profile' in data ? matches(data.profile.creator_id) : 'playlists' in data ? data.playlists.some(p => p.tracks.some(t => matches(t.creator_id))) : matches(data.blocked.creator_id)))) affectedBlocks.add(id);
        }
        for (const id of unblocked) {
            if (affectedBlocks.delete(id) || (state.data && 'blocked' in state.data && state.data.blocked.creator_id.toLowerCase() === id)) restore = true;
        }
        seen = next; ++epoch;
        if (changedAccount) {
            attempts.reset(); pageDepth = 1; commentCursors.clear(); affectedBlocks.clear(); emit({ status: 'loading', data: null, social: null, reply: null, error: null, notice: null, busy: false, refreshing: false, retryAt: 0 });
        } else if (next.availability === 'off') {
            emit({ status: 'off', data: null, social: null, reply: null, refreshing: false }); return;
        } else {
            const removed = state.reply && session.blocked(state.reply.author_id);
            const data = filter(state.data);
            emit({ data, social: data && 'blocked' in data ? null : state.social,
                ...(removed ? { reply: null, notice: 'replyRemoved' as const } : {}), refreshing: false });
        }
        // Blocks already removed discovery rows locally. Only affected threads or invalidated
        // in-flight reads need a fetch; hidden creators wait for unblock or focus.
        if (focused && (changedAccount || restore || interrupted || affectedComments) && !(state.data && 'blocked' in state.data && !restore)) void load(changedAccount || restore || state.social === null);
    });
    async function load(refreshSocial = true) {
        if (disposed) return;
        const ticket = ++epoch, revision = session.snapshot().revision;
        emit({ refreshing: true, error: null });
        try {
            const result = target.kind === 'explore' ? await getBestOf(api, session) : target.kind === 'track'
                ? await getPublicTrack(api, session, target.slug) : await getPublicProfile(api, session, target.handle);
            if (!valid(ticket, revision)) return;
            if (result.state !== 'on') { emit({ status: result.state, data: null, social: null, reply: null }); return; }
            let data: PublicData = result.data;
            if (target.kind === 'track' && 'track' in data && data.comments) {
                commentCursors.clear(); rememberComments(data.comments.comments);
                let merged = data.comments, depth = 1;
                if (target.before) {
                    merged = await getComments(api, session, target.slug, target.before);
                    if (!valid(ticket, revision)) return;
                    rememberComments(merged.comments, target.before);
                }
                while (depth < pageDepth && merged.next_cursor) {
                    const cursor = merged.next_cursor;
                    const page = await getComments(api, session, target.slug, cursor);
                    if (!valid(ticket, revision)) return;
                    if (page.next_cursor === cursor) throw new ApiError(200, 'bad_response');
                    rememberComments(page.comments, cursor);
                    merged = { ...page, comments: [...new Map([...merged.comments, ...page.comments].map(c => [c.id, c])).values()] };
                    depth++;
                }
                pageDepth = depth; data = { ...data, comments: merged };
            }
            emit({ status: 'on', data: filter(data), ...(refreshSocial ? { social: null } : {}) });
            if (refreshSocial && target.kind !== 'explore' && !('blocked' in result.data)) {
                try {
                    const social = await getSocial(api, target.kind === 'track' ? { slug: target.slug } : { handle: target.handle });
                    if (valid(ticket, revision)) emit({ social });
                } catch (error) {
                    if (valid(ticket, revision)) emit({ social: null, ...(error instanceof ApiError && error.code === 'not_found' ? {} : { error }) });
                }
            }
        } catch (error) {
            if (valid(ticket, revision)) emit({ status: state.data ? 'on' : 'error', error });
        } finally { if (valid(ticket, revision)) emit({ refreshing: false }); }
    }
    async function more() {
        if (state.busy || state.refreshing || target.kind !== 'track' || !state.data || !('track' in state.data) || !state.data.comments?.next_cursor) return;
        const ticket = epoch, revision = session.snapshot().revision, cursor = state.data.comments.next_cursor;
        emit({ refreshing: true, error: null });
        try {
            const page = await getComments(api, session, target.slug, cursor);
            if (!valid(ticket, revision) || !state.data || !('track' in state.data) || !state.data.comments) return;
            if (page.next_cursor === cursor) throw new ApiError(200, 'bad_response');
            pageDepth++; rememberComments(page.comments, cursor);
            const comments = [...state.data.comments.comments, ...page.comments];
            emit({ data: filter({ ...state.data, comments: { ...page, comments: [...new Map(comments.map(c => [c.id, c])).values()] } }) });
        } catch (error) {
            if (valid(ticket, revision)) {
                // Clear rejected pages; a fresh mirror decides whether the entire surface is off/blocked/gone.
                if (error instanceof ApiError && ['bad_response', 'creator_blocked', 'not_found'].includes(error.code)) {
                    if (state.data && 'track' in state.data) emit({ data: { ...state.data, comments: undefined }, reply: null });
                    await load();
                }
                if (!disposed && session.snapshot().availability !== 'off') emit({ error });
            }
        } finally { if (valid(ticket, revision)) emit({ refreshing: false }); }
    }
    async function write(w: PublicWrite) {
        if (state.busy || Date.now() < state.retryAt || session.snapshot().availability !== 'on') return false;
        const account = session.snapshot().account, revision = session.snapshot().revision;
        emit({ busy: true, error: null, notice: null });
        try {
            const receipt = await attempts.run(w);
            if (disposed || account !== session.snapshot().account) return false;
            emit({ notice: w.kind === 'submit' ? 'pending' : 'saved', reply: w.kind === 'submit' ? null : state.reply });
            if (revision === session.snapshot().revision) {
                if ('social' in receipt) {
                    // A follow answers a creator-level summary (no per-track reaction state): keep the track's reactions.
                    const keep = w.kind === 'follow' ? state.social : null;
                    emit({ social: keep ? { ...keep, following: receipt.social.following, follower_count: receipt.social.follower_count, is_own: receipt.social.is_own } : receipt.social });
                } 
                else await load();
            }
            return true;
        } catch (error) {
            if (account === session.snapshot().account && blocksOff(error)) session.unavailable();
            else if (!disposed && account === session.snapshot().account && isDefinitivePublicError(error)) {
                // A rejected attempt is no longer replayable; refresh the controls it invalidated.
                await load();
            }
            if (!disposed && account === session.snapshot().account) emit({ error: writeError(error, w),
                retryAt: error instanceof ApiError && error.status === 429 ? Date.now() + (error.retryAfterSeconds ?? 60) * 1000 : 0 });
            return false;
        } finally { if (!disposed && account === session.snapshot().account) emit({ busy: false }); }
    }
    async function block(id: string, blocked: boolean, name = '') {
        if (state.busy) return;
        const account = session.snapshot().account; emit({ busy: true, error: null });
        try {
            await changeBlock(api, session, id, blocked, name);
            if (account === session.snapshot().account) emit({ notice: state.notice === 'replyRemoved' ? 'replyRemoved' : 'saved' });
        }
        catch (error) { if (account === session.snapshot().account) emit({ error }); }
        finally { if (account === session.snapshot().account) emit({ busy: false }); }
    }
    function writeError(error: unknown, write: PublicWrite) {
        if (!isDefinitivePublicError(error) || blocksOff(error)) return error;
        if (error.code === 'not_found' || error.code === 'handle_not_found' || error.code.endsWith('_unavailable')) {
            const code = write.kind === 'reaction' || write.kind === 'follow' ? 'public_social_unavailable'
                : write.kind === 'report_song' ? 'public_reporting_unavailable'
                : write.kind === 'withdraw' || write.kind === 'report' ? 'public_comment_gone'
                : write.kind === 'submit' && write.parent_id && error.code === 'not_found' ? 'public_comment_gone' : 'comments_closed';
            return new ApiError(error.status, code);
        }
        return error;
    }
    return { snapshot: () => state, commentCursor: (id: string) => commentCursors.get(id), attempts, session, load, more, write, block,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        reply(comment: ApprovedComment | null) { emit({ reply: comment, notice: null }); },
        focus() { focused = true; void load(); },
        blur() { focused = false; ++epoch; emit({ refreshing: false }); },
        isLive: () => !disposed, dispose() { disposed = true; epoch++; unsubscribe(); attempts.reset(); listeners.clear(); },
    };
}
