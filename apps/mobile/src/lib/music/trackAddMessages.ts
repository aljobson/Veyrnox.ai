import { t } from '../i18n';
import { generationActionMessage } from './generationActionMessages';
import { MUSIC_TRACK_ADD_SOURCE_MAX } from './shared';
import type { TrackAddRequest } from './trackAddTypes';
export function trackAddMessage(code: string) {
    if (code === 'format_unavailable') return t('musicTrackAdd.format');
    if (code === 'source_duration_unavailable') return t('musicTrackAdd.sourceLimit', { seconds: MUSIC_TRACK_ADD_SOURCE_MAX });
    if (code === 'lyrics_invalid') return t('musicTrackAdd.lyricsInvalid');
    if (code === 'lyrics_rights_required') return t('musicTrackAdd.lyricsRights');
    if (['track_mode_invalid', 'vocal_gender_invalid', 'lyrics_not_applicable'].includes(code)) return t('musicTrackAdd.optionsInvalid');
    return generationActionMessage(code === 'track_add_acceptance_unknown' ? 'pair_acceptance_unknown' : code, 'extend');
}
export function trackAddStatusMessage(value: TrackAddRequest | null | undefined, waiting: boolean) {
    if (value?.state === 'refunded') return t('musicTrackAdd.refunded');
    if (value?.state === 'failed') return t(waiting ? 'musicTrackAdd.refundPending' : 'musicTrackAdd.failed');
    if (value?.state === 'ready') return t('musicTrackAdd.ready');
    return t(value?.stage === 'part_generation' ? 'musicTrackAdd.generating' : 'musicTrackAdd.uploading');
}
