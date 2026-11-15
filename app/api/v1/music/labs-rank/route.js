// Labs listen-and-rank without rewards (0538). No credits move.
//   GET                     the next pair for this listener (or pair: null)
//   GET ?song_id=<uuid>     the creator's own opt-in for one published song
//   POST { action: 'vote', pair_id, winner: 'a'|'b' }
//   POST { action: 'opt_in', song_id, allow }
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRankingEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { parseLabsRankAction, publicPair } from '../../../../veyrnox/_lib/music/labsRank.mjs';
import { isUuid } from '../../../../../lib/validate.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function gate(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!musicRankingEnabled()) return { error: reply({ error: 'music_ranking_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request) {
    const g = gate(request);
    if (g.error) return g.error;
    const songId = new URL(request.url).searchParams.get('song_id');
    try {
        if (songId !== null) {
            if (!isUuid(songId)) return reply({ error: 'song_id_invalid' }, 400);
            const result = await rpc('music_get_publication_ranking', { p_auth_id: g.authId, p_song_id: songId }, g.cfg);
            return result?.ok ? reply({ allow_ranking: result.allow_ranking === true }) : reply({ error: 'not_found' }, 404);
        }
        const result = await rpc('labs_rank_next_pair', { p_auth_id: g.authId }, g.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ pair: publicPair(result.pair) });
    } catch (error) {
        console.error('[music/labs-rank] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request) {
    const g = gate(request);
    if (g.error) return g.error;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseLabsRankAction(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        if (input.action === 'opt_in') {
            const result = await rpc('music_set_publication_ranking', { p_auth_id: g.authId, p_song_id: input.songId, p_allow: input.allow }, g.cfg);
            return result?.ok ? reply({ allow_ranking: result.allow_ranking === true }) : reply({ error: 'not_found' }, 404);
        }
        const result = await rpc('labs_rank_vote', { p_auth_id: g.authId, p_pair_id: input.pairId, p_winner: input.winner }, g.cfg);
        if (!result?.ok) {
            if (result?.code === 'TOO_SOON') return reply({ error: 'listen_first' }, 409);
            return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        }
        return reply({ recorded: true, ...(result.idempotent ? { idempotent: true } : {}) });
    } catch (error) {
        console.error('[music/labs-rank] write failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
