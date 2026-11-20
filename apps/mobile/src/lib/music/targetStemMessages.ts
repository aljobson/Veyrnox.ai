import { t } from '../i18n';
import { actionMessage } from './actionMessages';
import { MUSIC_TARGET_STEM_DURATION_MAX } from './shared';
export function targetStemMessage(code: string) {
    if (code === 'source_duration_unavailable') return t('musicTargetStems.durationLimit', { minutes: MUSIC_TARGET_STEM_DURATION_MAX / 60 });
    if (code === 'source_held' || code === 'held') return t('musicTargetStems.held');
    if (code === 'instrument_invalid') return t('musicTargetStems.choose');
    if (code === 'format_unavailable') return t('musicTargetStems.format');
    if (code === 'plan_unavailable' || code === 'subscription_required') return t('musicTargetStems.plan');
    return actionMessage(code === 'target_stem_acceptance_unknown' ? 'stem_acceptance_unknown' : code);
}
