// One typed seam over the shared plain-JS Music modules in ../../../../../lib (Metro watches that folder),
// in the style of ../instrumentShared.ts. Only pure parsers and constants are used here: the
// `*Enabled` helpers read server env and are always false on a phone, so never call them (ADR-0352).
// @ts-ignore the JS files may or may not carry inferred types depending on tsconfig; the casts below fix the shape.
import * as tabs from '../../../../../lib/musicLibraryTabs.js';
// @ts-ignore see above
import * as lyrics from '../../../../../lib/musicLyrics.js';
// @ts-ignore see above
import * as playlists from '../../../../../lib/musicPlaylists.js';
// @ts-ignore see above
import * as tempo from '../../../../../lib/musicTempoControls.js';
// @ts-ignore see above
import * as remix from '../../../../../lib/musicRemix.js';
// @ts-ignore see above
import * as wav from '../../../../../lib/musicWavRender.js';

// @ts-ignore plain JS shared gate; this seam is the mobile contract.
import { createQuoteGate as sharedQuoteGate } from '../../../../../lib/quoteRevisionGate.js';

type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };
export type TimeSignature = { value: string; label?: string };

export type LibraryTabAction = Parsed<{
    action: 'listen' | 'create_hook' | 'delete_hook' | 'set_cover';
    songId?: string; versionId?: string; hookId?: string; jobId?: string | null;
    title?: string; start?: number; end?: number; idempotencyKey?: string;
}>;
export type TempoParse = Parsed<{ bpm: number | null; keyScale: string | null; timeSignature: string | null; used: boolean }>;
export type RemixParse = Parsed<{
    kind: 'mashup' | 'sample'; versionId: string; prompt: string; rightsConfirmed: true;
    secondSongId?: string; secondVersionId?: string; sourceInfluence?: number;
    startSeconds?: number; endSeconds?: number; extendSeconds?: number;
}>;
export type PlaylistParse = Parsed<{
    action?: 'replace' | 'pin'; title?: string; expectedRevision?: number; songIds?: string[]; pinned?: boolean; idempotencyKey: string;
}>;
export type WavResult = { ok: true; bytes: Uint8Array; seconds: number } | { ok: false; error: string };

const t = tabs as unknown as {
    MUSIC_HOOK_SECONDS_MIN: number; MUSIC_HOOK_SECONDS_MAX: number;
    parseMusicLibraryTabAction: (value: unknown) => LibraryTabAction;
};
const l = lyrics as unknown as { MUSIC_BEST_OF_GENRES: readonly string[]; publicLyrics: (value: unknown) => string | null };
const p = playlists as unknown as {
    parsePlaylistCreate: (value: unknown) => PlaylistParse;
    parsePlaylistPatch: (value: unknown) => PlaylistParse;
};
const tp = tempo as unknown as {
    MUSIC_BPM_MIN: number; MUSIC_BPM_MAX: number; MUSIC_KEY_NOTES: readonly string[];
    MUSIC_KEY_SCALES: readonly string[]; MUSIC_TIME_SIGNATURES: readonly TimeSignature[];
    parseMusicTempoControls: (value: Record<string, unknown>) => TempoParse;
};
const r = remix as unknown as {
    MUSIC_REMIX_PROMPT_MAX: number; MUSIC_MASHUP_SECONDS_MIN: number; MUSIC_MASHUP_SECONDS_MAX: number;
    MUSIC_SAMPLE_SECONDS_MIN: number; MUSIC_SAMPLE_SECONDS_MAX: number;
    MUSIC_SAMPLE_EXTEND_MIN: number; MUSIC_SAMPLE_EXTEND_MAX: number;
    parseMusicRemixQuote: (value: unknown) => RemixParse;
    mashupSeconds: (first: number, second: number) => number;
};
const w = wav as unknown as {
    renderPcmWavCrop: (source: Uint8Array, start: number, end: number) => WavResult;
    renderPcmWavFade: (source: Uint8Array, fadeIn: number, fadeOut: number) => WavResult;
    renderPcmWavSpeed: (source: Uint8Array, ratio: number) => WavResult;
    renderPcmWavReverse: (source: Uint8Array) => WavResult;
    renderPcmWavMix: (first: Uint8Array, second: Uint8Array, maxSeconds?: number) => WavResult;
    // null when the audio is unreadable or not PCM WAV (lib/musicWavRender.js).
    pcmWavSeconds: (source: Uint8Array) => number | null;
};

export const { MUSIC_HOOK_SECONDS_MIN, MUSIC_HOOK_SECONDS_MAX, parseMusicLibraryTabAction } = t;
export const { MUSIC_BEST_OF_GENRES, publicLyrics } = l;
export const { parsePlaylistCreate, parsePlaylistPatch } = p;
export const {
    MUSIC_BPM_MIN, MUSIC_BPM_MAX, MUSIC_KEY_NOTES, MUSIC_KEY_SCALES, MUSIC_TIME_SIGNATURES, parseMusicTempoControls,
} = tp;
export const {
    MUSIC_REMIX_PROMPT_MAX, MUSIC_MASHUP_SECONDS_MIN, MUSIC_MASHUP_SECONDS_MAX, MUSIC_SAMPLE_SECONDS_MIN,
    MUSIC_SAMPLE_SECONDS_MAX, MUSIC_SAMPLE_EXTEND_MIN, MUSIC_SAMPLE_EXTEND_MAX, parseMusicRemixQuote, mashupSeconds,
} = r;
export const { renderPcmWavCrop, renderPcmWavFade, renderPcmWavSpeed, renderPcmWavReverse, renderPcmWavMix, pcmWavSeconds } = w;

export const createQuoteGate = sharedQuoteGate as () => {
    current(): number; start(): number; invalidate(): void;
    unchanged(revision: number): boolean; isCurrent(token: number): boolean; isLatestStart(token: number): boolean;
};

// Use the server's pure crop parser for its range limits and exact request shape.
// @ts-ignore plain JS parser, typed only at this seam.
import { parseMusicCrop as parseCrop } from '../../../../../lib/musicEditing.js';
export const parseMusicCrop = parseCrop as (value: unknown) => Parsed<{
    versionId: string; start: number; end: number; idempotencyKey: string;
}>;

// Target-stem limits and identifiers are server-owned constants, not mobile feature flags.
// @ts-ignore plain JS shared constants, typed only at this seam.
import * as backend from '../../../../../lib/musicBackend.js';
export type TargetStemInstrument = 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'strings' | 'synthesizer' | 'brass' | 'woodwinds';
export const { MUSIC_TARGET_STEM_INSTRUMENTS, MUSIC_TARGET_STEM_DURATION_MAX } = backend as unknown as {
    MUSIC_TARGET_STEM_INSTRUMENTS: readonly TargetStemInstrument[]; MUSIC_TARGET_STEM_DURATION_MAX: number;
};

export const { MUSIC_COVER_PROMPT_MAX, MUSIC_EXTEND_SECONDS, MUSIC_EXTEND_DURATION_MAX, MUSIC_COVER_DURATION_MAX } = backend as unknown as {
    MUSIC_COVER_PROMPT_MAX: number; MUSIC_EXTEND_SECONDS: number; MUSIC_EXTEND_DURATION_MAX: number; MUSIC_COVER_DURATION_MAX: number;
};

export const { MUSIC_LYRICS_MAX, MUSIC_STYLES_MAX, MUSIC_REPLACE_RANGE_MAX, MUSIC_REPLACE_DURATION_MAX, MUSIC_ADD_SECTION_SOURCE_MAX } = backend as unknown as {
    MUSIC_LYRICS_MAX: number; MUSIC_STYLES_MAX: number; MUSIC_REPLACE_RANGE_MAX: number;
    MUSIC_REPLACE_DURATION_MAX: number; MUSIC_ADD_SECTION_SOURCE_MAX: number;
};

export const { MUSIC_PROMPT_MAX, MUSIC_TRACK_ADD_SOURCE_MAX } = backend as unknown as {
    MUSIC_PROMPT_MAX: number; MUSIC_TRACK_ADD_SOURCE_MAX: number;
};
