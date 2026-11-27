import { t } from '../i18n';
import { actionMessage } from './actionMessages';
import type { RemixActionKind } from './remixActionTypes';

export function remixActionMessage(code: string, kind: RemixActionKind) {
    if (code === 'prompt_invalid') return t('musicRemix.promptRequired');
    if (code === 'prompt_not_allowed') return t('musicRemix.promptPolicy');
    if (code === 'source_influence_invalid') return t('musicRemix.influenceInvalid');
    if (code === 'second_song_invalid') return t('musicRemix.secondInvalid');
    if (code === 'sample_range_invalid') return t('musicRemix.rangeInvalid');
    if (code === 'sample_extend_invalid') return t('musicRemix.extendInvalid');
    if (code === 'mix_format_mismatch') return t('musicRemix.formatMismatch');
    if (code === 'source_duration_unavailable' || code === 'source_duration_invalid') {
        return t(`musicRemix.${kind}.sourceInvalid`);
    }
    return actionMessage(code === 'pair_acceptance_unknown' ? 'stem_acceptance_unknown' : code);
}
