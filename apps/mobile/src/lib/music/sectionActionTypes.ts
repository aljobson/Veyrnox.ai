import type { PairQuote, GenerationActionKind } from './generationActionTypes';
export type SectionActionKind = 'add_section' | 'replace_section';
export type AnyGenerationActionKind = GenerationActionKind | SectionActionKind;
// Mirrored from parseMusicAddSectionQuote; parser parity is checked in the validator tests.
export const SECTION_POSITIONS = ['beginning', 'end'] as const;
export const SECTION_DURATIONS = [10, 20, 30] as const;
export type SectionPosition = typeof SECTION_POSITIONS[number];
export type SectionDuration = typeof SECTION_DURATIONS[number];
export type AddSectionParameters = Readonly<{ position: SectionPosition; duration_seconds: SectionDuration; styles: string; lyrics?: string }>;
export type ReplaceParameters = Readonly<{ prompt: string; start_seconds: number; end_seconds: number }>;
export type MusicAddSectionQuote = PairQuote & Readonly<{ position: SectionPosition; duration_seconds: SectionDuration; instrumental: boolean }>;
export type MusicReplaceQuote = PairQuote & Readonly<{ start_seconds: number; end_seconds: number }>;
export type ReplaceCommit = Readonly<{ version_id: string; idempotent: boolean }>;
