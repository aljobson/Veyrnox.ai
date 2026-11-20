import { Platform, Text } from 'react-native';
import { editorTextPreviewStyle } from '../../lib/editorTextPreview';
import type { TextClip } from '../../lib/nativeEditorModel';
import { styles } from './fullEditorStyles';
export function EditorTextOverlay({ item }: { item: TextClip }) {
    return <Text style={[styles.previewCaption, editorTextPreviewStyle(item.style, item.size, Platform.OS)]}>{item.text}</Text>;
}
