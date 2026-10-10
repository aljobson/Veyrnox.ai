const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// No caller-supplied host, query, account identifier or signed playback token.
export function publicCinemaUrl(id, episode = false) {
  return typeof id === 'string' && UUID.test(id) ? `https://veyrnox.ai/social-cinema/${episode ? 'watch' : 'title'}/${id.toLowerCase()}` : null;
}
