import type { MusicActionQuote } from './actionTypes';
import type { MusicGeneration } from './types';
export type GenerationActionKind = 'extend' | 'cover';
export type PairQuote = Omit<MusicActionQuote, 'outputs'> & Readonly<{
    output_count: 2; credits_per_candidate: number; source_duration_seconds: number; policy_version: string;
}>;
export type MusicExtendQuote = PairQuote & Readonly<{ extend_seconds_after: number }>;
export type MusicCoverQuote = PairQuote & Readonly<{ source_influence: number }>;
export type GenerationActionStart = Omit<MusicGeneration, 'balance_after'> & Readonly<{ balance_after?: number }>;
