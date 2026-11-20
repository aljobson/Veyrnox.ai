import { Platform, Text, View } from 'react-native';
import { editorTextPreviewStyle } from '../../lib/editorTextPreview';
import type { TextClip } from '../../lib/nativeEditorModel';
import { styles } from './fullEditorStyles';
const { position, bottom, maxWidth, ...captionStyle } = styles.previewCaption;
export function EditorTextOverlay({ item }: { item: TextClip }) {
    const textStyle = editorTextPreviewStyle(item.style, item.size, Platform.OS, { outline: true });
    const alignItems = textStyle.textAlign === 'left' ? 'flex-start' : textStyle.textAlign === 'right' ? 'flex-end' : 'center';
    return <View style={{ position, bottom, width: maxWidth, direction: 'ltr', alignItems }}>
        <Text style={[captionStyle, textStyle]}>{item.text}</Text>
    </View>;
}
