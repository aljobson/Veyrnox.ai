// Labs listen-and-rank (0538): request parsing shared by the route and tests.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-f0-9]{24}$/;
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function parseLabsRankAction(value) {
    if (!plain(value)) return { ok: false, error: 'invalid_request' };
    const keys = Object.keys(value).sort().join(',');
    if (value.action === 'vote') {
        if (keys !== 'action,pair_id,winner' || !UUID_RE.test(value.pair_id || '') || !['a', 'b'].includes(value.winner)) return { ok: false, error: 'vote_invalid' };
        return { ok: true, action: 'vote', pairId: value.pair_id, winner: value.winner };
    }
    if (value.action === 'opt_in') {
        if (keys !== 'action,allow,song_id' || !UUID_RE.test(value.song_id || '') || typeof value.allow !== 'boolean') return { ok: false, error: 'opt_in_invalid' };
        return { ok: true, action: 'opt_in', songId: value.song_id, allow: value.allow };
    }
    return { ok: false, error: 'action_invalid' };
}

/** Only the public fields of a pair, with audio from the public track route. */
export function publicPair(pair) {
    if (!plain(pair) || !UUID_RE.test(pair.id || '')) return null;
    const side = (s) => (plain(s) && SLUG_RE.test(s.slug || '')
        ? { slug: s.slug, title: String(s.title || '').slice(0, 120), audio_url: `/api/music/public/${s.slug}/asset` } : null);
    const a = side(pair.a); const b = side(pair.b);
    return a && b ? { id: pair.id, a, b } : null;
}

/** How the ranking card explains a failed load: signed out is a prompt, not an error. */
export function rankLoadProblem(status) {
    if (status === 401) return { kind: 'signed_out', message: 'Sign in to rank tracks.' };
    if (status === 429) return { kind: 'limit', message: 'That is enough for today. Come back tomorrow.' };
    return { kind: 'failed', message: 'A pair could not be loaded.' };
}
