// The Music mini player keeps one song playing while a person moves between Music pages. These are
// its pure rules, unit-tested: what counts as a playable track and how the state changes.

const TITLE_MAX = 120;
const URL_MAX = 2000;
// A private song is signed on demand from its job asset route; a public one is an https address.
const PLAYABLE = /^(\/api\/v1\/jobs\/[0-9a-f-]{36}\/asset(#t=[\d.,]+)?|https:\/\/\S+)$/i;
const ID = /^[0-9a-zA-Z_-]{1,64}$/;

/** A clean track `{ id, title, audioUrl }`, or null when the input cannot be played. */
export function cleanTrack(input) {
  if (!input || typeof input !== 'object') return null;
  const id = typeof input.id === 'string' ? input.id : '';
  const audioUrl = typeof input.audioUrl === 'string' ? input.audioUrl.trim() : '';
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '';
  if (!ID.test(id) || !title || audioUrl.length > URL_MAX || !PLAYABLE.test(audioUrl)) return null;
  return { id, title, audioUrl };
}

export const idlePlayer = Object.freeze({ track: null, playing: false });

/** Reducer for the player state. Unknown actions and unplayable tracks leave the state as it was. */
export function playerReducer(state, action) {
  switch (action?.type) {
    case 'play': {
      const track = cleanTrack(action.track);
      return track ? { track, playing: true } : state;
    }
    case 'playing': return state.track && state.playing !== Boolean(action.value) ? { ...state, playing: Boolean(action.value) } : state;
    case 'close': return state.track ? idlePlayer : state;
    default: return state;
  }
}
