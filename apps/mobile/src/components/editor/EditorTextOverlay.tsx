import { Platform, Text, View } from 'react-native';
import { editorTextOverlayStyles } from '../../lib/editorTextPreview';
import type { TextClip } from '../../lib/nativeEditorModel';
import { CaptionWords } from './CaptionWords';
import { styles } from './fullEditorStyles';
const captionStyle = { ...styles.previewCaption, position: undefined, bottom: undefined, maxWidth: undefined, fontSize: undefined };
export function EditorTextOverlay({ item, frame, fontReady }: { item: TextClip; frame?: number; fontReady?(family: string): boolean }) {
    if (item.caption && item.words?.length && frame !== undefined && frame >= item.start && frame < item.start + item.len) {
        return <CaptionWords item={item} frame={frame} fontReady={fontReady} />;
    }
    const layout = editorTextOverlayStyles(item, Platform.OS, { outline: true, customFontReady: !!item.style?.font && !!fontReady?.(item.style.font) });
    const textStyle = layout.text;
    const alignItems = textStyle.textAlign === 'left' ? 'flex-start' : textStyle.textAlign === 'right' ? 'flex-end' : 'center';
    return <View style={[layout.wrapper, { alignItems }]}>
        <Text style={[captionStyle, textStyle]}>{item.text}</Text>
    </View>;
}
