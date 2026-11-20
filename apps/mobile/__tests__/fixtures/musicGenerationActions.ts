import { actionSong, SONG_ID, VERSION_ID, NEXT_VERSION_ID } from './musicActions';
import { quote, generation, view } from './musicCreate';
import type { MusicExtendQuote, MusicCoverQuote } from '../../src/lib/music/generationActionTypes';
const { mode, ...pair } = quote;
void mode;
export const extendQuote: MusicExtendQuote = { ...pair, output_count: 2, source_duration_seconds: 93.25, extend_seconds_after: 30 };
export const coverQuote: MusicCoverQuote = { ...pair, output_count: 2, source_duration_seconds: 93.25, source_influence: 50 };
export const generationSong = { ...actionSong, actions: ['extend', 'cover'] };
export const generationStart = generation;
export const generationReplay = { generation_id: generation.generation_id, state: 'running', candidates: generation.candidates, idempotent: true as const };
export const generationView = view;
export const readyView = { ...view, state: 'succeeded', candidates: view.candidates.map((c, i) => ({ ...c,
    state: 'ready', song_id: SONG_ID, version_id: i ? NEXT_VERSION_ID : VERSION_ID, audio_url: `/api/v1/jobs/${c.job_id}/asset` })) };
