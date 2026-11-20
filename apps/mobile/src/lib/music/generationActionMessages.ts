import { t } from '../i18n';
import { actionMessage } from './actionMessages';
import { MUSIC_EXTEND_DURATION_MAX, MUSIC_COVER_DURATION_MAX } from './shared';
import type { GenerationActionKind } from './generationActionTypes';
export function generationActionMessage(code: string, kind: GenerationActionKind) {
    if (code === 'source_duration_unavailable' || code === 'source_duration_invalid') return t(`musicGenerationActions.${kind}.limit`, {
        minutes: (kind === 'extend' ? MUSIC_EXTEND_DURATION_MAX : MUSIC_COVER_DURATION_MAX) / 60,
    });
    if (code === 'prompt_invalid') return t('musicGenerationActions.promptRequired');
    if (code === 'prompt_not_allowed') return t('musicGenerationActions.promptPolicy');
    if (code === 'source_influence_invalid') return t('musicGenerationActions.influenceInvalid');
    if (code === 'source_held') return t('musicTargetStems.held');
    return actionMessage(code === 'pair_acceptance_unknown' ? 'stem_acceptance_unknown' : code);
}
