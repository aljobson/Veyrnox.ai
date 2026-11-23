import type { MusicSongRow } from '../music/types';
// @ts-ignore authoritative shared web mapper
import * as shared from '../../../../../app/veyrnox/_lib/music/beat/beatLibrarySongs.mjs';

export type BeatLibrarySong = {
    id: string; source: 'song'; name: string; bpm: null;
    ref: { songId: string; versionId: string; jobId: string };
};

/** Maps only immutable song/version/job references; `audio_url` is deliberately never read. */
export const librarySongs = (shared as unknown as {
    librarySongs(rows: readonly MusicSongRow[]): BeatLibrarySong[];
}).librarySongs;
