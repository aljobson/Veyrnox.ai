import { OriginalAudioSection } from './OriginalAudioSection';
import { View } from 'react-native';
import { t, plural } from '../../../lib/i18n';

import { styles } from '../fullEditorStyles';
import { Action, PanelHeading, EmptyPanel } from '../EditorControls';

import { VOICEOVER_AVAILABLE } from '../../../lib/voiceoverRecorder';
import { InspectorClip } from './EditorRows';
import type { ToolPanelProps } from './types';
export function AudioPanel({ timeline, selections, selectClip, replacing, openVoiceover, openGenerate, addTimelineTrack, originalAudio }: Pick<ToolPanelProps, 'timeline' | 'selections' |
    'selectClip' |
    'replacing' | 'openVoiceover' | 'openGenerate' | 'addTimelineTrack' | 'originalAudio'>) {
    return <>
        <PanelHeading title={t('editor.audio')} detail={plural('editor.clips2Count', timeline.audio.length)} />
        {timeline.audio.length ? timeline.audio.map((item) => <InspectorClip key={item.id} track="audio" item={item} timeline={timeline} selected={selections.some((value) => value.track
            === 'audio' && value.id === item.id)} onPress={() => selectClip({ track: 'audio', id: item.id })} />) : <EmptyPanel title={t('editor.noaudioclips')}
            body={t('editor.audiolayersfromyourprojectappearhere')} />}
        <View style={styles.quickActions}>{VOICEOVER_AVAILABLE ? <Action label={t('editorVoiceover.open')} disabled={replacing} onPress={openVoiceover} /> : null}<Action
            label={t('editor.generatevoiceormusic')} onPress={() => openGenerate('audio')} /><Action label={t('editor.addaudiotrack')} onPress={() => addTimelineTrack('audio')} /></View>
        {originalAudio ? <OriginalAudioSection actions={originalAudio} /> : null}
    </>;
}
