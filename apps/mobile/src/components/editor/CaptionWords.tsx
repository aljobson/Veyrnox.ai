import { Platform, Text, View } from 'react-native';
import { captionPresentation, WORD_STYLE } from '../../../../../app/veyrnox/_lib/editorWords.mjs';
import { editorTextOverlayStyles } from '../../lib/editorTextPreview';
import type { TextClip } from '../../lib/nativeEditorModel';
import { styles } from './fullEditorStyles';
const captionStyle = { ...styles.previewCaption, position: undefined, bottom: undefined, maxWidth: undefined, fontSize: undefined };
export function CaptionWords({ item, frame, fontReady }: { item: TextClip; frame: number; fontReady?(family: string): boolean }) {
    const presentation = captionPresentation(item, frame - item.start) as { text: string; ranges: { from: number; to: number }[] };
    if (!presentation.text) return null;
    const layout = editorTextOverlayStyles(item, Platform.OS, { outline: true, customFontReady: !!item.style?.font && !!fontReady?.(item.style.font) });
    const textStyle = layout.text;
    const alignItems = textStyle.textAlign === 'left' ? 'flex-start' : textStyle.textAlign === 'right' ? 'flex-end' : 'center';
    const spans = []; let cursor = 0;
    for (const range of presentation.ranges) {
        if (range.from > cursor) spans.push(presentation.text.slice(cursor, range.from));
        spans.push(<Text key={range.from} style={{ color: item.wordStyle?.color || WORD_STYLE.color }}>{presentation.text.slice(range.from, range.to)}</Text>);
        cursor = range.to;
    }
    if (cursor < presentation.text.length) spans.push(presentation.text.slice(cursor));
    return <View style={[layout.wrapper, { alignItems }]}>
        <Text style={[captionStyle, textStyle]}>{spans}</Text>
    </View>;
}
