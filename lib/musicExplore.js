import { musicActorField, publicMusicCreator } from './musicActors.js';
import { rpc, envConfig } from '../packages/db/supabase-client.js';
import { validMusicAuthId, musicAlbumsEnabled, musicPublicationEnabled } from './musicBackend.js';
import { publicMusicAlbum } from './musicAlbums.js';
import { musicBlocksEnabled, musicAccountReadLimit, musicBlocksReply as reply } from './musicBlocks.js';
import { musicSocialEnabled, publicMusicSocial } from './musicSocial.js';
import { musicRailsEnabled, publicMusicRail } from './musicRails.js';
import { musicCommentsEnabled, publicMusicComments } from './musicComments.js';
import { musicBestOfEnabled, publicBestOf, musicPublicLyricsEnabled, publicLyrics } from './musicLyrics.js';
import { musicPlaysEnabled, musicSongReportsEnabled, publicPlayCount } from './musicPlays.js';

const SLUG_RE = /^[a-f0-9]{24}$/;
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
/** Authenticated mirrors. Off until blocks is enabled, so the phone never gets an unfiltered fallback. */
export function musicExploreHandler({ kind, rpcCall = rpc } = {}) {
    if (!['best-of', 'track', 'profile', 'album', 'albums'].includes(kind)) throw Error('invalid explore kind');
    return async (req, ctx) => {
        const auth = req.headers.get('x-veyrnox-auth-id');
        if (!validMusicAuthId(auth)) return reply({ error: 'not_authenticated' }, 401);
        if (!musicBlocksEnabled()) return reply({ error: 'blocks_unavailable' }, 404);
        if (!musicPublicationEnabled() || (kind === 'best-of' && !musicBestOfEnabled())
            || (['album', 'albums'].includes(kind) && !musicAlbumsEnabled())) return reply({ error: 'not_found' }, 404);
        try {
            if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_query' }, 400);
            const params = await ctx?.params || {};
            const { slug, handle } = params;
            if ((['track', 'album'].includes(kind) && !SLUG_RE.test(slug || '')) || (kind === 'profile' && !HANDLE_RE.test(handle || ''))) return reply({ error: 'not_found' }, 404);
            const cfg = envConfig();
            const limited = await musicAccountReadLimit(auth, cfg, rpcCall);
            if (limited) return limited;
            const name = kind === 'best-of' ? 'music_best_of_playlists_for_viewer'
                : kind === 'track' ? 'music_resolve_publication_for_viewer'
                    : kind === 'profile' ? 'music_read_public_profile_for_viewer'
                        : kind === 'album' ? 'music_read_public_album_for_viewer' : 'music_discover_albums_for_viewer';
            const result = await rpcCall(name, { p_auth_id: auth,
                ...(['track', 'album'].includes(kind) ? { p_slug: slug } : kind === 'profile' ? { p_handle: handle } : {}) }, cfg);
            if (result?.error === 'account_not_found') return reply({ error: 'account_not_found' }, 403);
            if (result?.blocked) {
                const actor = musicActorField(result.blocked.creator_id);
                if (!actor.creator_id || typeof result.blocked.display_name !== 'string') return reply({ error: 'temporarily_unavailable' }, 503);
                return reply({ blocked: { ...actor, display_name: result.blocked.display_name.slice(0, 80) } });
            }
            if (result?.ok !== true) return reply({ error: result?.code === 'NOT_FOUND' ? 'not_found' : 'temporarily_unavailable' }, result?.code === 'NOT_FOUND' ? 404 : 503);
            if (kind === 'best-of') return reply({ playlists: publicBestOf(result) });
            if (kind === 'albums') return reply({ albums: (result.albums || []).map(publicMusicAlbum).filter(Boolean) });
            if (kind === 'album') {
                const album = publicMusicAlbum(result.album);
                if (!album) return reply({ error: 'temporarily_unavailable' }, 503);
                return reply({ album: { ...album, tracks: album.tracks.map((track) => ({ ...track,
                    audio_url: `/api/music/public/${track.slug}/asset` })) }, reports: { open: true } });
            }
            const social = musicSocialEnabled()
                ? await rpcCall('music_social_summary', { p_slug: slug || null, p_handle: handle || null, p_auth_id: auth }, cfg).catch(() => null) : null;
            if (kind === 'profile') {
                const albums = musicAlbumsEnabled() ? await rpcCall('music_list_profile_albums_for_viewer', { p_auth_id: auth, p_handle: handle }, cfg).catch(() => null) : null;
                return reply({ profile: publicMusicCreator(result.profile), tracks: (result.tracks || []).map(publicMusicCreator),
                    ...(albums?.ok ? { albums: (albums.albums || []).map(publicMusicAlbum).filter(Boolean) } : {}),
                    ...(social?.ok ? { social: publicMusicSocial(social) } : {}) });
            }
            // Filtering failures fail closed instead of returning unfiltered UGC.
            const rails = musicRailsEnabled() ? await rpcCall('music_public_rails_for_viewer', { p_slug: slug, p_auth_id: auth }, cfg) : null;
            const comments = musicCommentsEnabled() ? await rpcCall('music_comments_read_for_viewer', { p_slug: slug, p_auth_id: auth, p_before_id: null }, cfg) : null;
            if ((musicRailsEnabled() && !rails?.ok) || (musicCommentsEnabled() && !comments?.ok)) return reply({ error: 'temporarily_unavailable' }, 503);
            const lyrics = musicPublicLyricsEnabled() ? await rpcCall('music_public_lyrics', { p_slug: slug }, cfg).catch(() => null) : null;
            const plays = musicPlaysEnabled() ? await rpcCall('music_public_play_count', { p_slug: slug }, cfg).catch(() => null) : null;
            const { job_id: _jobId, ...track } = result.track;
            return reply({
                track: { ...publicMusicCreator(track), audio_url: `/api/music/public/${slug}/asset` },
                ...(social?.ok ? { social: publicMusicSocial(social) } : {}),
                ...(rails?.ok ? { rails: { by_creator: publicMusicRail(rails.by_creator), similar: publicMusicRail(rails.similar) } } : {}),
                ...(comments?.ok ? { comments: publicMusicComments(comments, { viewer: true }) } : {}),
                ...(lyrics?.ok && publicLyrics(lyrics.lyrics) ? { lyrics: publicLyrics(lyrics.lyrics) } : {}),
                ...(plays?.ok ? { plays: { count: publicPlayCount(plays) } } : {}),
                ...(musicSongReportsEnabled() ? { reports: { open: true } } : {}),
            });
        } catch {
            return reply({ error: 'temporarily_unavailable' }, 503);
        }
    };
}
