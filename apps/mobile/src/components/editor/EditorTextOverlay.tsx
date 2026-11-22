import { Platform, Text, View } from 'react-native';
import { editorTextPreviewStyle } from '../../lib/editorTextPreview';
import type { TextClip } from '../../lib/nativeEditorModel';
import { CaptionWords } from './CaptionWords';
import { styles } from './fullEditorStyles';
const { position, bottom, maxWidth, ...captionStyle } = styles.previewCaption;
export function EditorTextOverlay({ item, frame, fontReady }: { item: TextClip; frame?: number; fontReady?(family: string): boolean }) {
    if (item.caption && item.words?.length && frame !== undefined && frame >= item.start && frame < item.start + item.len) {
        return <CaptionWords item={item} frame={frame} fontReady={fontReady} />;
    }
    const textStyle = editorTextPreviewStyle(item.style, item.size, Platform.OS, { outline: true, customFontReady: !!item.style?.font && !!fontReady?.(item.style.font) });
    const alignItems = textStyle.textAlign === 'left' ? 'flex-start' : textStyle.textAlign === 'right' ? 'flex-end' : 'center';
    return <View style={{ position, bottom, width: maxWidth, direction: 'ltr', alignItems }}>
        <Text style={[captionStyle, textStyle]}>{item.text}</Text>
    </View>;
}
