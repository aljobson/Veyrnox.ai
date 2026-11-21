// Typed seams only. The web renderer, planner, WAV encoder and save rules remain the source of truth.
import './takeRuntime';
import type { BeatDoc, BeatTrackDoc } from './doc';
// @ts-ignore shared JavaScript
import * as render from '../../../../../app/veyrnox/_lib/music/beat/beatMixdown.js';
// @ts-ignore shared JavaScript
import * as planner from '../../../../../app/veyrnox/_lib/music/beat/beatExport.mjs';
// @ts-ignore shared JavaScript
import * as wav from '../../../../../app/veyrnox/_lib/music/beat/beatWav.mjs';
// @ts-ignore shared JavaScript
import * as audio from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';
// @ts-ignore shared JavaScript
import * as mix from '../../../../../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
// @ts-ignore shared JavaScript
import * as sources from '../../../../../app/veyrnox/_lib/music/beat/beatMixdownSources.mjs';
// @ts-ignore shared JavaScript
import * as attempts from '../../../../../app/veyrnox/_lib/music/beat/beatSaveAttempt.mjs';
export { encodeWav } from '../instrumentShared';
export type ExportRange = 'song' | 'cycle';
export type ExportOptions = { kind: 'song' | 'pattern'; loops: number; range: ExportRange; output: 'mix' | 'stems'; bitDepth: 16 | 24; editTrackId?: string };
export type PCMBuffer = { length: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };
export type SongBuffers = Map<string, { buffer?: PCMBuffer; reverse?: PCMBuffer; missing: boolean }>;
export type Chunk = { startSec: number; endSec: number; originSec: number; contextFrames: number };
export type ExportPlan = { frames: number; seconds: number; sampleRate: number; channels: number; bitDepth: 16 | 24; chunks: Chunk[]; tracks: { id: string; name: string; audible: boolean; filename: string }[]; filenames: string[] };
export type WavWriter = { write(channels: Float32Array[], offset?: number): void; finish(): ArrayBuffer };
export type SaveAttempt = { payload: string; sha256: string; key: string };
export const { renderSong, renderBeat } = render as {
    renderSong(doc: BeatDoc, options: Partial<Chunk> & { buffers: SongBuffers; range: ExportRange; soloTrackId?: string }): Promise<{ channels: Float32Array[]; sampleRate: number }>;
    renderBeat(doc: BeatDoc, loops: number, editTrackId?: string): Promise<{ samples: Float32Array; sampleRate: number }>;
};
export const { planExport, assembleExport, exportFilename } = planner as {
    planExport(doc: BeatDoc, options: { range: ExportRange; output: 'mix' | 'stems'; bitDepth: 16 | 24; phone: boolean }): ExportPlan;
    assembleExport(plan: ExportPlan, render: (chunk: Chunk) => Promise<{ channels: Float32Array[] }>, writer: WavWriter): Promise<ArrayBuffer>;
    exportFilename(title: string, suffix?: string): string;
};
export const { createWavWriter } = wav as { createWavWriter(options: { channels: number; frames: number; sampleRate: number; bitDepth: 16 | 24 }): WavWriter };
export const { usedAssets, estimateExport, MB } = audio as { usedAssets(doc: BeatDoc): string[]; estimateExport(doc: BeatDoc, frames: number): number; MB: number };
export const { mixTailSeconds, patternTailSeconds } = mix as { mixTailSeconds(doc: BeatDoc): number; patternTailSeconds(doc: BeatDoc, track?: BeatTrackDoc): number };
export const { mixdownSources } = sources as { mixdownSources(doc: BeatDoc, options: { range: ExportRange }): { songs: { song_id: string; version_id: string }[]; hasTakes: boolean } };
export const { mixdownSaveAttempt } = attempts as { mixdownSaveAttempt(previous: SaveAttempt | null, payload: string, sha: string, createKey: () => string): SaveAttempt };
