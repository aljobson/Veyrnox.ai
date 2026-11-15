import { validAsset } from './beatAudioRules.mjs';

// Both music_list_songs and music_library_songs expose these immutable IDs.
// Neither list supplies duration or BPM; duration is measured when adding audio.
export function librarySongs(songs) {
  const items = new Map();
  for (const song of Array.isArray(songs) ? songs : []) {
    if (!song) continue;
    const item = { id: `${song.id}:${song.version_id}`, source: 'song',
      name: typeof song.title === 'string' && song.title.trim() ? song.title.slice(0, 80) : 'Untitled song',
      bpm: null, ref: { songId: song.id, versionId: song.version_id, jobId: song.job_id } };
    const { id, ...asset } = item;
    if (validAsset({ ...asset, durationSec: 1, sourceChannels: 2, encodedBytes: 0 })) items.set(id, item);
  }
  return [...items.values()];
}
