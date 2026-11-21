import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { fittedMediaStyle, previewTransformStyle } from '../../lib/editorMotionPreview';
import type { Clip, Media } from '../../lib/nativeEditorModel';
import { useEditorFrame, type FrameStore } from './editorFrameStore';
export function EditorTransformLayer({ clip, media, frameStore, children }: { clip: Clip; media: Media; frameStore: FrameStore; children: ReactNode }) {
    const frame = useEditorFrame(frameStore), [size, setSize] = useState({ width: 0, height: 0 });
    return <View testID="editor-transform-layout" pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layout]}
        onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize({ width, height }); }}>
        <View testID="editor-transform-picture" style={[{ position: 'absolute' }, fittedMediaStyle(clip, media, size.width, size.height),
            previewTransformStyle(clip, frame - clip.start, size.width, size.height)]}>{children}</View>
    </View>;
}
const styles = StyleSheet.create({ layout: { direction: 'ltr' } });
