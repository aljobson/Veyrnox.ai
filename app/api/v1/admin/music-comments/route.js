/**
 * /api/v1/admin/music-comments — the Music comment review queue (0518).
 *
 *   GET                                              pending comments and open reports, oldest first, 50 each
 *   POST { action, id, decision?, reason }           approve, reject or remove a comment, or resolve a comment or song report
 *        (Idempotency-Key header)
 *
 * Same four gates as /api/v1/admin/metrics (lib/adminGate.js). The queue stays
 * open when the comments switch is off, so held comments can still be cleared.
 */

import { NextResponse } from 'next/server';
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { adminGate, idempotencyKey, rpcFailure, rpcRefusal, readJsonObject, NO_STORE } from '../../../../../lib/adminGate.js';
import { parseMusicCommentReview } from '../../../../../lib/musicComments.js';
import { parseMusicSongReportResolve } from '../../../../../lib/musicPlays.js';

const WHERE = 'api/v1/admin/music-comments';

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    let result;
    try {
        result = await rpc('music_comment_review_list', { p_auth_id: g.authId }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'queue_unavailable');
    // Song reports (0533) join the same queue. Before 0533 is applied the RPC is
    // missing; the comment queue still loads and song_reports is left out.
    const songs = await rpc('music_song_report_list', { p_auth_id: g.authId }, g.cfg).catch(() => null);
    return NextResponse.json({
        comments: Array.isArray(result.comments) ? result.comments : [],
        reports: Array.isArray(result.reports) ? result.reports : [],
        ...(songs?.ok === true ? { song_reports: Array.isArray(songs.song_reports) ? songs.song_reports : [] } : {}),
    }, { headers: NO_STORE });
}

export async function POST(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const key = idempotencyKey(req);
    if (key.response) return key.response;
    const b = await readJsonObject(req);
    if (b.response) return b.response;
    const songReport = b.body?.action === 'resolve_song_report';
    const input = songReport ? parseMusicSongReportResolve(b.body) : parseMusicCommentReview(b.body);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400, headers: NO_STORE });
    let result;
    try {
        result = await rpc(songReport ? 'music_song_report_resolve' : 'music_comment_review', { p_auth_id: g.authId, p_idempotency_key: key.key, p_payload: input.payload }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (result?.code === 'SELF_REVIEW') return NextResponse.json({ error: 'self_review_forbidden' }, { status: 409, headers: NO_STORE });
    if (result?.code === 'ALREADY_REVIEWED') return NextResponse.json({ error: 'already_reviewed' }, { status: 409, headers: NO_STORE });
    if (!result || result.ok !== true) return rpcRefusal(result, 'review_rejected', ['not_found']);
    return NextResponse.json({ id: result.id, status: result.status, replayed: result.idempotent === true }, { status: result.idempotent === true ? 200 : 201, headers: NO_STORE });
}
