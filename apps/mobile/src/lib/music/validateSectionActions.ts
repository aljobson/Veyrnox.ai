import { isFiniteNumber, isRecord } from '../responseShapes';
import { pairQuote, validActionPrompt } from './validateGenerationActions';
import { MUSIC_LYRICS_MAX, MUSIC_STYLES_MAX, MUSIC_REPLACE_RANGE_MAX, MUSIC_REPLACE_DURATION_MAX, MUSIC_ADD_SECTION_SOURCE_MAX } from './shared';
import { SECTION_POSITIONS, SECTION_DURATIONS } from './sectionActionTypes';
import type { AddSectionParameters, ReplaceParameters, MusicAddSectionQuote, MusicReplaceQuote, ReplaceCommit, SectionPosition, SectionDuration } from './sectionActionTypes';
export const isSectionUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/i.test(v);
export const validSectionPosition = (v: unknown): v is SectionPosition => SECTION_POSITIONS.some(p => p === v);
export const validSectionDuration = (v: unknown): v is SectionDuration => SECTION_DURATIONS.some(d => d === v);
export const validSectionStyles = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MUSIC_STYLES_MAX;
export const validSectionLyrics = (v: unknown): boolean => v === undefined || (typeof v === 'string' && v.trim().length <= MUSIC_LYRICS_MAX);
// Keep the server's arithmetic expression. The UI uses integer half-seconds to avoid rounding drift.
export const validReplaceRange = (start: unknown, end: unknown): boolean => isFiniteNumber(start) && isFiniteNumber(end)
    && start >= 0 && end > start && end - start >= 1 && end - start <= MUSIC_REPLACE_RANGE_MAX;
export const validAddSection = (v: unknown): v is AddSectionParameters => isRecord(v) && validSectionPosition(v.position)
    && validSectionDuration(v.duration_seconds) && validSectionStyles(v.styles) && validSectionLyrics(v.lyrics);
export const validReplace = (v: unknown): v is ReplaceParameters => isRecord(v) && validActionPrompt(v.prompt) && validReplaceRange(v.start_seconds, v.end_seconds);
export const isMusicAddSectionQuote = (v: unknown): v is MusicAddSectionQuote => pairQuote(v)
    && validSectionPosition(v.position) && validSectionDuration(v.duration_seconds) && typeof v.instrumental === 'boolean'
    && (v.source_duration_seconds as number) >= 1 && (v.source_duration_seconds as number) <= MUSIC_ADD_SECTION_SOURCE_MAX;
export const isMusicReplaceQuote = (v: unknown): v is MusicReplaceQuote => pairQuote(v) && validReplaceRange(v.start_seconds, v.end_seconds)
    && (v.source_duration_seconds as number) >= 1 && (v.source_duration_seconds as number) <= MUSIC_REPLACE_DURATION_MAX
    && (v.end_seconds as number) <= (v.source_duration_seconds as number);
export const isReplaceCommit = (v: unknown): v is ReplaceCommit => isRecord(v) && isSectionUuid(v.version_id) && typeof v.idempotent === 'boolean';
