import { guardedBeforeSend } from '../guardedBeforeSend';
import { defaultProbe, ensureOnline } from '../network';
import { createStemQuote, startStems, getStemRequest } from './client';
import type { ActionSpec, StemStart, StemRequest } from './actionTypes';
export const STEM_REJECTIONS = new Set(['format_unavailable', 'edit_unavailable_for_format', 'plan_unavailable', 'model_unavailable', 'source_unavailable',
    'source_rights_required', 'version_id_invalid', 'song_id_invalid']);
export const stemsAction = (songId: string): ActionSpec<StemStart, StemRequest> => ({
    name: 'stems', keyPrefix: 'stems', definitiveCodes: STEM_REJECTIONS,
    // If connectivity needs probing, local guards must run before even that HEAD request.
    // The actual POST still passes through the API client's guards again.
    beforeConfirm: () => ensureOnline(async () => {
        await guardedBeforeSend(`/api/v1/music/songs/${encodeURIComponent(songId)}/stems`, 'POST');
        return defaultProbe();
    }),
    quote: (api, input) => createStemQuote(api, input.song_id, input.version_id),
    confirm: (api, quoteId, key) => startStems(api, songId, quoteId, key),
    status: (api, result) => getStemRequest(api, result.request_id),
    terminal: value => ['ready', 'failed', 'refunded'].includes(value.state),
});
