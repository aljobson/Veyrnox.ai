import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { transcriptEntries, transcriptRange } from '../../../../../../app/veyrnox/_lib/editorTranscript.mjs';
import { captionRefusal } from '../../../lib/editorCaptionErrors';
import type { TranscriptSelection } from '../../../lib/editorCaptionEdit';
import { t, plural, rawText, formatNumber } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import type { Timeline } from '../../../lib/nativeEditorModel';
import { touchTarget } from '../../../lib/a11y';
import { Text as StatusText } from '../../ui/Text';
import { Action, Choice, LabeledInput } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { SegmentedChoice } from './SegmentedChoice';
import type { CaptionActions } from './useCaptionActions';
type Entry = { key: string; captionId: string; wordIndex: number | null; text: string; start: number; len: number; estimated: boolean };
export function TranscriptSection({ timeline, actions }: { timeline: Timeline; actions: CaptionActions }) {
    const [track, setTrack] = useState('all'), [find, setFind] = useState(''), [selection, setSelection] = useState<TranscriptSelection>(null);
    const [complete, setComplete] = useState(false);
    const trackId = timeline.tracks.some(c => c.id === track) ? track : 'all';
    const entries = transcriptEntries(timeline, trackId) as Entry[];
    const range = transcriptRange(timeline, selection, trackId);
    const error = 'error' in range ? captionRefusal(range.error) : null;
    const status = error ? t(error.key, error.params) : plural('editorCaptionTools.range', range.entries!.length, { start: formatNumber(range.start! / timeline.fps, 2), end: formatNumber(range.end! / timeline.fps, 2),
    });
    useAnnouncement(selection ? status : null);
    const single = selection?.first === selection?.last ? entries.find(w => w.key === selection?.first && w.wordIndex !== null) : undefined;
    const a = entries.findIndex(w => w.key === selection?.first), b = entries.findIndex(w => w.key === selection?.last);
    const visible = timeline.text.filter(c => c.caption && (trackId === 'all' || c.trackId === trackId))
        .sort((left, right) => left.start - right.start).filter(c => c.text.toLocaleLowerCase().includes(find.trim().toLocaleLowerCase()));
    return <>
        <SegmentedChoice label={t('editorCaptionTools.track')} value={trackId} options={[
            { value: 'all', label: t('editorCaptionTools.allTracks') },
            ...timeline.tracks.filter(c => c.kind === 'text').map(c => ({ value: c.id, label: c.name })),
        ]} onChange={value => { setTrack(value); setSelection(null); setComplete(false); }} />
        <LabeledInput label={t('editorCaptionTools.find')} value={find} onChangeText={setFind} />
        {visible.length ? visible.map(cue => <View key={cue.id} style={styles.choices}>
            {entries.filter(w => w.captionId === cue.id).map(word => {
                const i = entries.indexOf(word), chosen = a >= 0 && b >= 0 && i >= Math.min(a, b) && i <= Math.max(a, b);
                return <Choice key={word.key} label={word.estimated
                    ? t('editorCaptionTools.estimatedWord', { n: i + 1, text: word.text }) : t('editorCaptionTools.wordLabel', { n: i + 1, text: word.text })}
                    selected={chosen} onPress={() => {
                        actions.select(word.captionId, word.start);
                        if (!selection || complete) { setSelection({ first: word.key, last: word.key }); setComplete(false); }
                        else if (selection.first !== word.key) { setSelection({ ...selection, last: word.key }); setComplete(true); }
                    }} />;
            })}
        </View>) : <Text style={styles.panelDetail}>{t('editorCaptionTools.noMatches')}</Text>}
        <Action label={t('editorCaptionTools.clearSelection')} disabled={!selection} onPress={() => { setSelection(null); setComplete(false); }} />
        <StatusText variant="inherit" style={styles.panelDetail}>{status}</StatusText>
        <Action label={t('editorCaptionTools.cut')} disabled={!!error || actions.busy} onPress={() => {
            if (actions.cut(selection, trackId)) { setSelection(null); setComplete(false); }
        }} />
        {single ? <TextInput accessibilityLabel={rawText(t('editorCaptionTools.correct'))} key={`${single.key}:${single.text}`} defaultValue={single.text} maxLength={100}
            style={[styles.input, touchTarget]} onEndEditing={event => {
                if (event.nativeEvent.text !== single.text) actions.correct(single.key, event.nativeEvent.text);
            }} /> : null}
        {entries.length ? <Action label={t('editorCaptionTools.shareText')} disabled={actions.busy || actions.sharing} onPress={() => actions.share('txt', trackId)} /> : null}
    </>;
}
