import { t } from '../i18n';
import { generationActionMessage } from './generationActionMessages';
import { MUSIC_ADD_SECTION_SOURCE_MAX, MUSIC_REPLACE_DURATION_MAX, MUSIC_REPLACE_RANGE_MAX } from './shared';
import type { ActionErrorMetadata } from './actionErrorMetadata';
import type { SectionActionKind } from './sectionActionTypes';
export function sectionActionMessage(code: string, kind: SectionActionKind, metadata: ActionErrorMetadata | null) {
    if (code === 'range_invalid') return metadata?.source_duration_seconds !== undefined
        ? t('musicSectionActions.rangeMeasured', { seconds: metadata.source_duration_seconds, max: MUSIC_REPLACE_RANGE_MAX, limit: MUSIC_REPLACE_DURATION_MAX })
        : t('musicSectionActions.rangeInvalid', { max: MUSIC_REPLACE_RANGE_MAX });
    if (code === 'source_duration_invalid' || code === 'source_duration_unavailable') return t('musicSectionActions.sourceLimit', {
        seconds: metadata?.max_duration_seconds ?? (kind === 'add_section' ? MUSIC_ADD_SECTION_SOURCE_MAX : MUSIC_REPLACE_DURATION_MAX),
    });
    if (code === 'styles_invalid') return t('musicSectionActions.stylesInvalid');
    if (code === 'lyrics_invalid') return t('musicSectionActions.lyricsInvalid');
    if (code === 'section_position_invalid' || code === 'section_duration_invalid') return t('musicSectionActions.optionsInvalid');
    return generationActionMessage(code, 'extend');
}
