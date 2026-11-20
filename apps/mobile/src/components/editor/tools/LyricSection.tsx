import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { lyricSourceCaptions } from '../../../../../../app/veyrnox/_lib/editorLyrics.mjs';
import { t, plural, rawText } from '../../../lib/i18n';
import type { Timeline, TextClip } from '../../../lib/nativeEditorModel';
import { touchTarget } from '../../../lib/a11y';
import { Action } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { SegmentedChoice } from './SegmentedChoice';
import type { CaptionActions } from './useCaptionActions';
export function LyricSection({ timeline, actions }: { timeline: Timeline; actions: CaptionActions }) {
    const [lyrics, setLyrics] = useState(''), [source, setSource] = useState('all');
    const sources = lyricSourceCaptions(timeline) as TextClip[];
    const sourceId = sources.some(c => c.id === source) ? source : 'all';
    return <>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorCaptionTools.align')}</Text>
        <SegmentedChoice label={t('editorCaptionTools.source')} value={sourceId} onChange={setSource}
            options={[{ value: 'all', label: t('editorCaptionTools.allSources') }, ...sources.map(c => ({ value: c.id, label: c.text.slice(0, 40) }))]} />
        <TextInput accessibilityLabel={rawText(t('editorCaptionTools.lyrics'))} multiline maxLength={16000} value={lyrics} onChangeText={setLyrics}
            style={[styles.input, styles.inputMultiline, touchTarget]} />
        <Text style={styles.panelDetail}>{t('editorCaptionTools.lyricsHelp')}</Text>
        <Text style={styles.panelDetail}>{sources.length ? plural('editorCaptionTools.sources', sources.length) : t('editorCaptionTools.lyricsNoTiming')}</Text>
        <Action label={t('editorCaptionTools.align')} disabled={!sources.length || !lyrics.trim() || actions.busy} onPress={() => actions.align(lyrics, sourceId)} />
    </>;
}
