import { Platform, Text, View } from 'react-native';
import { captionPresentation, WORD_STYLE } from '../../../../../app/veyrnox/_lib/editorWords.mjs';
import { editorTextPreviewStyle } from '../../lib/editorTextPreview';
import type { TextClip } from '../../lib/nativeEditorModel';
import { styles } from './fullEditorStyles';
const { position, bottom, maxWidth, ...captionStyle } = styles.previewCaption;
export function CaptionWords({ item, frame }: { item: TextClip; frame: number }) {
    const presentation = captionPresentation(item, frame - item.start) as { text: string; ranges: { from: number; to: number }[] };
    if (!presentation.text) return null;
    const textStyle = editorTextPreviewStyle(item.style, item.size, Platform.OS, { outline: true });
    const alignItems = textStyle.textAlign === 'left' ? 'flex-start' : textStyle.textAlign === 'right' ? 'flex-end' : 'center';
    const spans = []; let cursor = 0;
    for (const range of presentation.ranges) {
        if (range.from > cursor) spans.push(presentation.text.slice(cursor, range.from));
        spans.push(<Text key={range.from} style={{ color: item.wordStyle?.color || WORD_STYLE.color }}>{presentation.text.slice(range.from, range.to)}</Text>);
        cursor = range.to;
    }
    if (cursor < presentation.text.length) spans.push(presentation.text.slice(cursor));
    return <View style={{ position, bottom, width: maxWidth, direction: 'ltr', alignItems }}>
        <Text style={[captionStyle, textStyle]}>{spans}</Text>
    </View>;
}
