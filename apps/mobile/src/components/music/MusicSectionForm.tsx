import { TextInput, View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { SECTION_POSITIONS, SECTION_DURATIONS } from '../../lib/music/sectionActionTypes';
import type { SectionActionKind } from '../../lib/music/sectionActionTypes';
import { MUSIC_LYRICS_MAX, MUSIC_STYLES_MAX, MUSIC_COVER_PROMPT_MAX, MUSIC_REPLACE_RANGE_MAX } from '../../lib/music/shared';
import { validReplaceRange } from '../../lib/music/validateSectionActions';
import { replaceRange, sourceRangeHint } from '../../lib/music/sectionForm';
export function MusicSectionForm({ kind, parameters: p, edit, locked, duration }: {
    kind: SectionActionKind; parameters: Readonly<Record<string, unknown>>; edit(patch: Record<string, unknown>): void; locked: boolean; duration?: unknown;
}) {
    const s = useThemedStyles(sheets), range = replaceRange(p), bound = sourceRangeHint(duration);
    const field = (key: string, label: string, maxLength: number) => <View>
        <Text>{label}</Text><TextInput accessibilityLabel={label} multiline maxLength={maxLength} editable={!locked}
            value={String(p[key] ?? '')} onChangeText={value => edit({ [key]: value })} style={s.input} />
    </View>;
    return kind === 'add_section' ? <>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('musicSectionActions.position')}>
            <Text>{t('musicSectionActions.position')}</Text>
            {SECTION_POSITIONS.map(position => <Button key={position} variant="secondary" accessibilityRole="radio"
                accessibilityState={{ checked: p.position === position }} label={t(`musicSectionActions.position.${position}`)}
                disabled={locked} onPress={() => edit({ position })} />)}
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('musicSectionActions.duration')}>
            <Text>{t('musicSectionActions.duration')}</Text>
            {SECTION_DURATIONS.map(duration_seconds => <Button key={duration_seconds} variant="secondary" accessibilityRole="radio"
                accessibilityState={{ checked: p.duration_seconds === duration_seconds }} label={t(`musicSectionActions.duration.${duration_seconds}`)}
                disabled={locked} onPress={() => edit({ duration_seconds })} />)}
        </View>
        {field('styles', t('musicSectionActions.styles'), MUSIC_STYLES_MAX)}
        {field('lyrics', t('musicSectionActions.lyrics'), MUSIC_LYRICS_MAX)}
        <Text>{t('musicSectionActions.lyricsHint')}</Text>
    </> : <>
        {field('prompt', t('musicGenerationActions.prompt'), MUSIC_COVER_PROMPT_MAX)}
        {(['start', 'end'] as const).map(edge => {
            const key = `${edge}_half`, value = Number(p[key]);
            return <View key={edge}>
                <Text accessibilityLiveRegion="polite">{t(`musicSectionActions.${edge}`, { seconds: value / 2 })}</Text>
                <Button variant="secondary" label={t(`musicSectionActions.${edge}Less`)} disabled={locked || value <= 0} onPress={() => edit({ [key]: Math.max(0, value - 1) })} />
                <Button variant="secondary" label={t(`musicSectionActions.${edge}More`)} disabled={locked || value >= bound} onPress={() => edit({ [key]: Math.min(bound, value + 1) })} />
            </View>;
        })}
        {!validReplaceRange(range.start_seconds, range.end_seconds) ? <Text accessibilityRole="alert">{t('musicSectionActions.rangeInvalid', { max: MUSIC_REPLACE_RANGE_MAX })}</Text> : null}
        {typeof duration === 'number' && Number.isFinite(duration) ? <Text>{t('musicSectionActions.sourceHint', { seconds: duration })}</Text> : null}
    </>;
}
const sheets = themedStyles(p => ({ input: { color: p.textPrimary, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12,
    padding: ds.space.md, minHeight: 100, textAlignVertical: 'top' } }));
