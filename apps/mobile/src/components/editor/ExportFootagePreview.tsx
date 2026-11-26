import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { framesIn, type Timeline } from '../../lib/nativeEditorModel';
import { PlaybackPreview } from './EditorPlayback';
import { createFrameStore } from './editorFrameStore';

export const boundedExportPreviewFrame = (frame: number, timeline: Timeline) => Math.max(0, Math.min(Math.max(0, framesIn(timeline) - 1), Math.round(frame)));

export function ExportFootagePreview({ timeline, frame, api, localMediaUris }: {
    readonly timeline: Timeline; readonly frame: number; readonly api: Pick<ApiClient, 'request'>;
    readonly localMediaUris: Readonly<Record<string, string>>;
}) {
    const [frameStore] = useState(createFrameStore);
    const sources = useMemo(() => ({ ...localMediaUris }), [localMediaUris]);
    useEffect(() => frameStore.set(boundedExportPreviewFrame(frame, timeline)), [frame, frameStore, timeline]);
    return <View testID="editor-export-footage-preview" style={styles.frame}>
        <PlaybackPreview staticPreview frameStore={frameStore} timeline={timeline} api={api} playing={false} localMediaUris={sources} />
    </View>;
}

const styles = StyleSheet.create({ frame: { height: 180, overflow: 'hidden', borderRadius: 10, backgroundColor: '#000000' } });
