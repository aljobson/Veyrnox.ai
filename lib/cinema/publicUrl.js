import { isUuidLoose } from '../validate.js';
// No caller-supplied host, query, account identifier or signed playback token.
export function publicCinemaUrl(id, episode = false) {
  return typeof id === 'string' && isUuidLoose(id) ? `https://veyrnox.ai/social-cinema/${episode ? 'watch' : 'title'}/${id.toLowerCase()}` : null;
}
