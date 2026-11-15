import { gatewayFetch } from '../../_lib/gateway';

/** Record a play in the person's own History (0523). Best effort: a failed write never stops playback. */
export function recordMusicListen(songId) {
  gatewayFetch('/music/history', { method: 'POST', body: JSON.stringify({ song_id: songId }), promptOnAuth: false }).catch(() => {});
}
