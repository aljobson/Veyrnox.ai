import { isFiniteNumber, isRecord } from '../responseShapes';
import { isMusicGeneration } from './validate';
import { MUSIC_COVER_PROMPT_MAX, MUSIC_EXTEND_SECONDS } from './shared';
import type { MusicExtendQuote, MusicCoverQuote, GenerationActionStart } from './generationActionTypes';
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const validActionPrompt = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MUSIC_COVER_PROMPT_MAX;
export const validSourceInfluence = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 10 && v <= 90;
const pairQuote = (v: unknown): v is Record<string, unknown> => isRecord(v)
    && ['quote_id', 'model_id', 'policy_version'].every(k => str(v[k]))
    && str(v.expires_at) && Number.isFinite(Date.parse(v.expires_at)) && v.output_count === 2
    && ['credits_per_candidate', 'total_credits', 'balance', 'balance_after'].every(k => isFiniteNumber(v[k]))
    && typeof v.affordable === 'boolean' && isFiniteNumber(v.source_duration_seconds) && v.source_duration_seconds > 0;
export const isMusicExtendQuote = (v: unknown): v is MusicExtendQuote => pairQuote(v) && v.extend_seconds_after === MUSIC_EXTEND_SECONDS;
export const isMusicCoverQuote = (v: unknown): v is MusicCoverQuote => pairQuote(v) && validSourceInfluence(v.source_influence);
// A replay can omit its balance. Validate every other P2 field without weakening P2's validator.
// Non-finite replay balances are deliberately discarded at the boundary, never displayed or invented.
export function parseGenerationActionStart(v: unknown): GenerationActionStart | null {
    if (!isRecord(v)) return null;
    if (v.idempotent === true && !isFiniteNumber(v.balance_after)) {
        if (!isMusicGeneration({ ...v, balance_after: 0 })) return null;
        const { balance_after: ignored, ...result } = v;
        void ignored;
        return result as GenerationActionStart;
    }
    return isMusicGeneration(v) ? v : null;
}
