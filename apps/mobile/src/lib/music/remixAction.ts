import { ApiError } from '../api';
import { guardedBeforeSend } from '../guardedBeforeSend';
import { defaultProbe, ensureOnline } from '../network';
import { createRemixQuote, getGeneration, startRemix } from './client';
import { getMusicCreateSession } from './createSession';
import { GENERATION_ACTION_REJECTIONS } from './generationAction';
import { notifySongChanged } from './songChanges';
import { parseMusicRemixQuote } from './shared';
import type { ActionInput, ActionSpec } from './actionTypes';
import type { MusicGenerationView } from './types';
import type { MusicRemixQuote, MusicRemixQuoteRequest, MusicRemixStart, RemixActionKind } from './remixActionTypes';

export const REMIX_ACTION_REJECTIONS = new Set([
    ...GENERATION_ACTION_REJECTIONS,
    'second_song_invalid', 'sample_range_invalid', 'sample_extend_invalid', 'mix_format_mismatch',
    'edit_unavailable_for_format', 'format_unavailable', 'invalid_request', 'invalid_inputs',
]);

function requestFor(kind: RemixActionKind, input: ActionInput): MusicRemixQuoteRequest {
    const p = input.parameters ?? {};
    const value = kind === 'mashup' ? {
        kind,
        version_id: input.version_id,
        second_song_id: p.second_song_id,
        second_version_id: p.second_version_id,
        prompt: p.prompt,
        source_influence: p.source_influence,
        rights_confirmed: input.rights_confirmed,
    } : {
        kind,
        version_id: input.version_id,
        start_seconds: p.start_seconds,
        end_seconds: p.end_seconds,
        extend_seconds: p.extend_seconds,
        prompt: p.prompt,
        rights_confirmed: input.rights_confirmed,
    };
    const parsed = parseMusicRemixQuote(value);
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    return value as MusicRemixQuoteRequest;
}

export function remixAction(kind: RemixActionKind, songId: string): ActionSpec<MusicRemixStart, MusicGenerationView, MusicRemixQuote> {
    let notified = false;
    return {
        name: kind,
        keyPrefix: kind,
        definitiveCodes: REMIX_ACTION_REJECTIONS,
        balanceOnReplay: 'omit',
        resultBalanceOnly: true,
        beforeConfirm: () => ensureOnline(async () => {
            await guardedBeforeSend(`/api/v1/music/songs/${encodeURIComponent(songId)}`, 'POST');
            return defaultProbe();
        }),
        quote: (api, input) => createRemixQuote(api, input.song_id, requestFor(kind, input), kind),
        confirm: (api, quoteId, key) => startRemix(api, songId, quoteId, key),
        accepted(api, result, input, quote) {
            getMusicCreateSession(api).tracker.add(result, {
                mode: 'simple', model_id: quote.model_id, prompt: String(input.parameters?.prompt ?? '').trim(),
                title: '', lyrics: '', styles: '', instrumental: true, duration: 30, variety: 50,
                styleInfluence: 0, excludeStyles: '', sunoModel: 'v6', vocalGender: 'auto', weirdness: 0.5,
                bpm: '', keyScale: '', timeSignature: '',
            }, kind);
        },
        status: (api, result) => getGeneration(api, result.generation_id),
        terminal(value) {
            const terminal = ['succeeded', 'partial', 'failed', 'refunded'].includes(value.state);
            if (terminal && !notified && value.candidates.some(candidate => candidate.state === 'ready')) {
                notified = true;
                notifySongChanged();
            }
            return terminal;
        },
    };
}
