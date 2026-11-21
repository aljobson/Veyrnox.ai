import { ApiError } from '../api';
import { guardedBeforeSend } from '../guardedBeforeSend';
import { defaultProbe, ensureOnline } from '../network';
import { GENERATION_ACTION_REJECTIONS } from './generationAction';
import { createTrackAddQuote, startTrackAdd, getTrackAdd } from './client';
import { trackAddInputError, validTrackAdd } from './validateTrackAdd';
import type { ActionSpec } from './actionTypes';
import type { MusicTrackAddQuote, TrackAddStart, TrackAddRequest } from './trackAddTypes';
export const TRACK_ADD_REJECTIONS = new Set([...GENERATION_ACTION_REJECTIONS, 'track_mode_invalid', 'vocal_gender_invalid',
    'lyrics_invalid', 'lyrics_rights_required', 'lyrics_not_applicable']);
export const trackAddAction = (songId: string): ActionSpec<TrackAddStart, TrackAddRequest, MusicTrackAddQuote> => ({
    name: 'add_track', keyPrefix: 'trackadd', definitiveCodes: TRACK_ADD_REJECTIONS, resultBalanceOnly: true,
    beforeConfirm: () => ensureOnline(async () => {
        await guardedBeforeSend(`/api/v1/music/songs/${encodeURIComponent(songId)}/track-adds`, 'POST');
        return defaultProbe();
    }),
    quote(api, input) {
        if (!validTrackAdd(input.parameters)) throw new ApiError(400, trackAddInputError(input.parameters) ?? 'invalid_request');
        return createTrackAddQuote(api, input.song_id, input.version_id, input.parameters, input.rights_confirmed);
    },
    confirm: (api, quoteId, key) => startTrackAdd(api, songId, quoteId, key),
    status: (api, result) => getTrackAdd(api, result.request_id),
    // Failed generation can still settle a refund. The shared foreground ceiling bounds settlement reads.
    terminal: value => value.state === 'ready' || value.state === 'refunded',
});
