import { Pressable, Text, TextInput, View } from 'react-native';
import { rawText, t } from '../../../lib/i18n';

import { styles } from '../fullEditorStyles';
import { Action, PanelHeading } from '../EditorControls';
import { formatTimecode as timecode } from '../../../lib/editorTimeline';
import { timelineOf } from '../../../lib/nativeEditorModel';

import type { ToolPanelProps } from './types';
export function MarkersPanel({ timeline, addTimelineMarker, setPlaying, setFrame, currentDocument, applyTimeline }: Pick<ToolPanelProps, 'timeline' | 'addTimelineMarker' | 'setPlaying' |
    'setFrame' | 'currentDocument' | 'applyTimeline'>) {
    return <>
        <PanelHeading title={t('editorCore.markersTool')} detail={t('editor.markers', { value1: timeline.markers.length })} />
        <Action label={t('editor.addmarker')} onPress={addTimelineMarker} />
        {timeline.markers.map(marker => <View key={marker.id} style={styles.markerRow}><Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editor.goto', { value1:
            marker.label }))} onPress={() => { setPlaying(false); setFrame(marker.frame); }} style={styles.markerJump}><Text style={styles.markerTime}>{timecode(marker.frame,
            timeline.fps)}</Text></Pressable><TextInput key={`${marker.id}-${marker.label}`} accessibilityLabel={rawText(t('editor.rename', { value1: marker.label }))}
            defaultValue={marker.label} maxLength={80} style={[styles.input, styles.markerInput]} onEndEditing={event => { const label = event.nativeEvent.text; const current =
            timelineOf(currentDocument()?.timeline); if (label !== marker.label) applyTimeline({ ...current, markers: current.markers.map(item => item.id === marker.id ? { ...item, label
            } : item) }); }} /><Action label={t('editor.remove')} danger compact onPress={() => applyTimeline({ ...timeline, markers: timeline.markers.filter(item => item.id !==
            marker.id) })} /></View>)}
    </>;
}
