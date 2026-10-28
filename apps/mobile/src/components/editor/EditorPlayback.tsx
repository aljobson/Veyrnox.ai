import type { ComponentProps } from 'react';
import { Text, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { activeEditorMedia } from '../../lib/editorPreview';
import { t } from '../../lib/i18n';
import type { Timeline } from '../../lib/nativeEditorModel';
import { EditorMediaPreview } from './EditorMediaPreview';
import { EditorTimeline } from './EditorTimeline';
import { EditorTransport } from './EditorTransport';
import { useEditorFrame, type FrameStore } from './editorFrameStore';
import { styles } from './fullEditorStyles';

type Playback = { frameStore: FrameStore };
export function PlaybackTransport({ frameStore, ...props }: Playback & Omit<ComponentProps<typeof EditorTransport>, 'frame'>) {
    const frame = useEditorFrame(frameStore);
    return <EditorTransport {...props} frame={frame} />;
}
export function PlaybackTimeline({ frameStore, ...props }: Playback & Omit<ComponentProps<typeof EditorTimeline>, 'frame'>) {
    const frame = useEditorFrame(frameStore);
    return <EditorTimeline {...props} frame={frame} />;
}
export function PlaybackPreview({ frameStore, timeline, api, playing, localMediaUris }: Playback & {
    timeline: Timeline; api: Pick<ApiClient, 'request'>; playing: boolean; localMediaUris: Record<string, string>;
}) {
    const frame = useEditorFrame(frameStore);
    const active = activeEditorMedia(timeline, frame);
    const caption = timeline.text.find(item => frame >= item.start && frame < item.start + item.len)?.text ?? timeline.text[0]?.text;
    return <>
        {active ? <EditorMediaPreview api={api} clip={active.clip} media={active.media} frameStore={frameStore} fps={timeline.fps} playing={playing} localUri={localMediaUris[active.media.id]} /> : null}
        <View style={styles.safeFrame} />
        {!active ? <><Text style={styles.previewMark}>{t('editor.v')}</Text><Text style={styles.previewLabel}>{timeline.video.length ? t('editor.movetheplayheadontoavisualclip') : t('editor.previewEmpty')}</Text></> : null}
        {caption ? <Text style={styles.previewCaption}>{caption}</Text> : null}
    </>;
}
