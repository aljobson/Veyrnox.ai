// Import audit: these modules and their transitive imports only define functions/constants.
// Browser storage defaults are evaluated on invocation; only injected storage is used here.
// beatAiResults.js/beatAssets.js and beatZip.mjs are deliberately excluded (browser audio/streams).
// @ts-ignore shared pure JS
import * as ai from '../../../../../app/veyrnox/_lib/music/beat/beatAi.mjs';
// @ts-ignore shared pure JS
import * as ops from '../../../../../app/veyrnox/_lib/music/beat/beatAiOps.mjs';
// @ts-ignore shared pure functions only
import * as pending from '../../../../../app/veyrnox/_lib/music/beat/beatAiPending.mjs';
// @ts-ignore storage is always injected
import * as magic from '../../../../../app/veyrnox/_lib/music/beat/magicBar.mjs';
// @ts-ignore shared pure JS
import * as rules from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';
// @ts-ignore shared pure JS
import * as availability from '../../../../../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';
// @ts-ignore shared pure JS
import * as probe from '../../../../../app/veyrnox/_lib/music/beat/beatAudioProbe.mjs';
// @ts-ignore shared pure JS
import * as length from '../../../../../lib/mediaLength.js';
import type { AiDoc, Asset, AudioRegion, Layer, Op, Pending, Result, Song } from './types';
export type Translator = (key: string, params?: Record<string, string | number>) => string;
export const { aiPaths, aiPollPath, generateBody, actionBody, actionEligibility, aiError, trackCapacity, BEAT_AI_KEYS, AI_INSTRUMENTS, AI_TERMINAL } = ai as unknown as {
    aiPaths(op: Op, songId?: string): { quote: string; submit: string };
    aiPollPath(record: { op: Op; requestId?: string }): string;
    generateBody(doc: AiDoc, prompt: string, key?: string): Record<string, unknown>;
    actionBody(op: Op, args: { doc: AiDoc; region: AudioRegion; asset: Asset; prompt: string; instrument: string; rights: boolean }): Record<string, unknown>;
    actionEligibility(op: Op, doc: AiDoc, region: AudioRegion, asset: Asset, song: Song | null, state: object, t: Translator): string;
    trackCapacity(doc: AiDoc, t: Translator): string;
    aiError(error: unknown, op: Op, t: Translator): string;
    BEAT_AI_KEYS: string[]; AI_INSTRUMENTS: string[]; AI_TERMINAL: Set<string>;
};
export const { placeAiResults, placedAlready } = ops as unknown as {
    placeAiResults(doc: AiDoc, record: Pending, results: Result[]): AiDoc;
    placedAlready(doc: AiDoc, record: Pending, ordinal: number): boolean;
};
export type Failure = { status: number; code: string; retryAfter?: number };
export const { placementIds, validPending, definitivelyRefused, singleFlight } = pending as unknown as {
    placementIds(key: string): Pending['placementIds']; validPending(value: unknown): boolean;
    definitivelyRefused(error: Failure): boolean;
    singleFlight(): <T>(work: () => Promise<T>) => Promise<T>;
};
export type SyncStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export const { barChoices, magicQuoteBody, requestSeconds, MAGIC_BARS, MAGIC_PROMPT_MAX, MAGIC_LAYER_LIMIT, readLayers, writeLayers } = magic as unknown as {
    barChoices(bpm: number): number[]; requestSeconds(bpm: number, bars: number): number;
    magicQuoteBody(input: { prompt: string; bpm: number; bars: number; title: string }): Record<string, unknown>;
    MAGIC_BARS: number[]; MAGIC_PROMPT_MAX: number; MAGIC_LAYER_LIMIT: number;
    readLayers(id: string, storage: SyncStorage): Layer[]; writeLayers(id: string, layers: Layer[], storage: SyncStorage): boolean;
};
export const { validAsset, admitScan, admitDecode, checkDecoded } = rules as unknown as {
    validAsset(value: unknown, bpm: number): boolean; admitScan(bytes: number): number;
    admitDecode(asset: Pick<Asset, 'durationSec' | 'sourceChannels' | 'encodedBytes'>): number;
    checkDecoded(buffer: Decoded, asset: Asset): void;
};
export type Decoded = { numberOfChannels: number; sampleRate: number; length: number };
export const { assetSigningPath, isHeldError } = availability as unknown as { assetSigningPath(asset: Pick<Asset, 'source' | 'ref'>): string | null; isHeldError(e: unknown): boolean };
export type Header = { container: string; channels: number | null; sampleRate: number | null; durationSec: number | null; needsFullHeader?: boolean };
export const { probeAudioHeader, admitProbe } = probe as unknown as { probeAudioHeader(bytes: Uint8Array, total: number): Header; admitProbe(header: Header): void };
export const { mp3Seconds } = length as unknown as { mp3Seconds(bytes: Uint8Array, total: number): number | null };
