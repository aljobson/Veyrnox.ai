// A speech model reads the prompt aloud; it does not sing it. When someone picks one and writes what
// sounds like a song request, point them at Music instead of charging for a reading. Pure and
// unit-tested. The match is English words and lyric section tags only: a missed song is just no hint.

export const MUSIC_STUDIO_HREF = '/app/music/create';

const SONG_WORDS = /\b(songs?|lyrics?|chorus|verses?|sing|sings|singing|sung|melody|melodies|jingle|ballad|lullaby|rap|rapping|a cappella)\b/i;
const SECTION_TAG = /\[(intro|verse|pre-?chorus|chorus|bridge|hook|outro)[^\]]*\]/i;

/** True when the text reads like a request for a song or contains lyric section tags. */
export function looksLikeSong(prompt) {
  const text = String(prompt || '');
  return text.trim().length > 0 && (SECTION_TAG.test(text) || SONG_WORDS.test(text));
}

/** True when a speech model is selected and the prompt looks like a song, so the Music hint shows. */
export function showSpeechSongNudge(model, prompt) {
  return Boolean(model?.isSpeech) && looksLikeSong(prompt);
}
