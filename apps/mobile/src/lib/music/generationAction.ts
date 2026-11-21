import { ApiError } from '../api';
import { guardedBeforeSend } from '../guardedBeforeSend';
import { defaultProbe, ensureOnline } from '../network';
import { createExtendQuote, createCoverQuote, startExtend, startCover, getGeneration } from './client';
import { STEM_REJECTIONS } from './stemsAction';
import { validActionPrompt, validSourceInfluence } from './validateGenerationActions';
import { getMusicCreateSession } from './createSession';
import { notifySongChanged } from './songChanges';
import type { ActionSpec } from './actionTypes';
import type { MusicGenerationView } from './types';
import type { GenerationActionKind, GenerationActionStart } from './generationActionTypes';
export const GENERATION_ACTION_REJECTIONS = new Set([...STEM_REJECTIONS, 'prompt_invalid', 'prompt_not_allowed',
    'source_influence_invalid', 'source_duration_unavailable', 'source_duration_invalid', 'source_changed', 'revision_conflict', 'source_held']);
export function generationAction(kind: GenerationActionKind, songId: string): ActionSpec<GenerationActionStart, MusicGenerationView> {
    let notified = false;
    return {
        name: kind, keyPrefix: kind, definitiveCodes: GENERATION_ACTION_REJECTIONS, balanceOnReplay: 'omit', resultBalanceOnly: true,
        beforeConfirm: () => ensureOnline(async () => {
            await guardedBeforeSend(`/api/v1/music/songs/${encodeURIComponent(songId)}/${kind}s`, 'POST');
            return defaultProbe();
        }),
        quote: (api, input) => {
            const prompt = input.parameters?.prompt, influence = input.parameters?.source_influence;
            if (!validActionPrompt(prompt)) throw new ApiError(400, 'prompt_invalid');
            if (kind === 'cover') {
                if (!validSourceInfluence(influence)) throw new ApiError(400, 'source_influence_invalid');
                return createCoverQuote(api, input.song_id, input.version_id, prompt, influence);
            }
            return createExtendQuote(api, input.song_id, input.version_id, prompt);
        },
        confirm: (api, quoteId, key) => (kind === 'extend' ? startExtend : startCover)(api, songId, quoteId, key),
        accepted(api, result, input, quote) {
            getMusicCreateSession(api).tracker.add(result, { mode: 'simple', model_id: quote.model_id,
                prompt: String(input.parameters?.prompt ?? '').trim(), title: '', lyrics: '', styles: '', instrumental: true, duration: 30,
                variety: 50, styleInfluence: 0, excludeStyles: '', bpm: '', keyScale: '', timeSignature: '' }, kind);
        },
        status: (api, result) => getGeneration(api, result.generation_id),
        terminal(value) {
            const terminal = ['succeeded', 'partial', 'failed', 'refunded'].includes(value.state);
            if (terminal && !notified && value.candidates.some(c => c.state === 'ready')) { notified = true; notifySongChanged(); }
            return terminal;
        },
    };
}
