import { ApiError } from '../api';
import { guardedBeforeSend } from '../guardedBeforeSend';
import { defaultProbe, ensureOnline } from '../network';
import { createTargetStemQuote, startTargetStems, getTargetStemRequest } from './client';
import { STEM_REJECTIONS } from './stemsAction';
import { isTargetStemInstrument } from './validateTargetStems';
import type { ActionSpec } from './actionTypes';
import type { TargetStemStart, TargetStemRequest } from './targetStemTypes';
export const TARGET_STEM_REJECTIONS = new Set([...STEM_REJECTIONS, 'instrument_invalid', 'source_duration_unavailable', 'source_held', 'revision_conflict']);
export const targetStemsAction = (songId: string): ActionSpec<TargetStemStart, TargetStemRequest> => ({
    name: 'target_stem', keyPrefix: 'targetstems', definitiveCodes: TARGET_STEM_REJECTIONS, balanceOnReplay: 'omit',
    beforeConfirm: () => ensureOnline(async () => {
        await guardedBeforeSend(`/api/v1/music/songs/${encodeURIComponent(songId)}/target-stems`, 'POST');
        return defaultProbe();
    }),
    quote: (api, input) => {
        const instrument = input.parameters?.instrument;
        if (!isTargetStemInstrument(instrument)) throw new ApiError(400, 'instrument_invalid');
        return createTargetStemQuote(api, input.song_id, input.version_id, instrument);
    },
    confirm: (api, quoteId, key) => startTargetStems(api, songId, quoteId, key),
    status: (api, result) => getTargetStemRequest(api, result.request_id),
    terminal: value => ['ready', 'failed', 'refunded'].includes(value.state),
});
