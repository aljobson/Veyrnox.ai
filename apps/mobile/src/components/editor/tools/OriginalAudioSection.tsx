import { useEffect, useState } from 'react';
import { Text as StatusText } from '../../ui/Text';
import { Pressable, Text, View } from 'react-native';
import { ds } from '../../../theme';
import { formatNumber, plural, rawText, t } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { ORIGINAL_AUDIO } from '../../../lib/editorOriginalAudio';
import { Action, LabeledInput } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { SegmentedChoice } from './SegmentedChoice';
import type { OriginalAudioActions } from './useOriginalAudio';
export function OriginalAudioSection({ actions }: { actions: OriginalAudioActions }) {
    const [search, setSearch] = useState(''), [category, setCategory] = useState('all');
    const { stop } = actions;
    useEffect(() => () => stop(), [stop]);
    const rows = ORIGINAL_AUDIO.filter(p => (category === 'all' || p.category === category) && `${p.title} ${p.tags}`.toLowerCase().includes(search.trim().toLowerCase()));
    return <View style={{ gap: ds.space.sm }}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorAudioTools.original')}</Text>
        <Text style={styles.body}>{t('editorAudioTools.originalHelp')}</Text>
        <LabeledInput label={t('editorAudioTools.search')} value={search} onChangeText={setSearch} />
        <SegmentedChoice label={t('editorAudioTools.category')} value={category} onChange={setCategory} options={[
            { value: 'all', label: t('editorAudioTools.all') }, { value: 'Music', label: t('editorAudioTools.music') },
            { value: 'Sound effects', label: t('editorAudioTools.soundEffects') }]} />
        <StatusText variant="inherit" accessibilityLiveRegion="polite" style={styles.muted}>{plural('editorAudioTools.sounds', rows.length)}</StatusText>
        {!rows.length ? <Text style={styles.body}>{t('editorAudioTools.noMatches')}</Text> : null}
        {rows.map(p => {
            const selected = actions.preview === p.id;
            const label = selected ? t('editorAudioTools.stop') : t('editorAudioTools.preview', { name: p.title });
            return <View key={p.id} style={{ gap: ds.space.xs }}>
                <Text style={styles.rowTitle}>{rawText(p.title)}</Text>
                <Text style={styles.muted}>{t('editorAudioTools.description', { category: p.category === 'Music' ? t('editorAudioTools.music') : t('editorAudioTools.soundEffects'),
                    time: formatNumber(p.seconds, 1) })}{p.bpm ? t('editorAudioTools.bpm', { value: formatNumber(p.bpm, 0) }) : ''}</Text>
                <View style={styles.quickActions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} accessibilityState={{ selected, disabled: actions.preparing }}
                        disabled={actions.preparing} style={[styles.action, touchTarget]} onPress={() => selected ? actions.stop() : void actions.play(p.id)}>
                        <Text style={styles.actionText}>{label}</Text>
                    </Pressable>
                    <Action label={t('editorAudioTools.insert', { name: p.title })} disabled={actions.preparing} onPress={() => void actions.insert(p.id)} />
                </View>
            </View>;
        })}
        <Text style={styles.body}>{t('editorAudioTools.audioLaneNote')}</Text>
    </View>;
}
