import { ApiError } from '../api';
import { guardedBeforeSend } from '../guardedBeforeSend';
import { defaultProbe, ensureOnline } from '../network';
import { createAddSectionQuote, createReplaceQuote, startAddSection, startReplace } from './client';
import { generationAction, GENERATION_ACTION_REJECTIONS } from './generationAction';
import { getMusicCreateSession } from './createSession';
import { replaceRange } from './sectionForm';
import { validActionPrompt } from './validateGenerationActions';
import { validAddSection, validReplace } from './validateSectionActions';
import type { SectionActionKind } from './sectionActionTypes';
export const SECTION_ACTION_REJECTIONS = new Set([...GENERATION_ACTION_REJECTIONS,
    'section_position_invalid', 'section_duration_invalid', 'styles_invalid', 'lyrics_invalid', 'range_invalid']);
export function sectionAction(kind: SectionActionKind, songId: string) {
    const base = generationAction('extend', songId);
    return { ...base, name: kind, keyPrefix: kind === 'add_section' ? 'addsection' : 'replace', definitiveCodes: SECTION_ACTION_REJECTIONS,
        beforeConfirm: () => ensureOnline(async () => {
            await guardedBeforeSend(`/api/v1/music/songs/${encodeURIComponent(songId)}/${kind === 'add_section' ? 'sections' : 'replacements'}`, 'POST');
            return defaultProbe();
        }),
        quote: ((api, input) => {
            const parameters = input.parameters;
            if (kind === 'add_section') {
                if (!validAddSection(parameters)) throw new ApiError(400, 'invalid_request');
                return createAddSectionQuote(api, songId, input.version_id, parameters);
            }
            if (!validActionPrompt(parameters?.prompt)) throw new ApiError(400, 'prompt_invalid');
            const range = { ...parameters, ...replaceRange(parameters ?? {}) };
            if (!validReplace(range)) throw new ApiError(400, 'range_invalid');
            return createReplaceQuote(api, songId, input.version_id, range);
        }) as typeof base.quote,
        confirm: ((api, quoteId, key) => (kind === 'add_section' ? startAddSection : startReplace)(api, songId, quoteId, key)) as typeof base.confirm,
        accepted: ((api, result, input, quote) => {
            getMusicCreateSession(api).tracker.add(result, { mode: 'simple', model_id: quote.model_id,
                prompt: String(input.parameters?.prompt ?? '').trim(), title: '', lyrics: '', styles: '', instrumental: true, duration: 30 }, kind);
        }) as NonNullable<typeof base.accepted>,
    };
}
