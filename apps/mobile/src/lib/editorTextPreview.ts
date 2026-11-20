import type { TextStyle } from 'react-native';
import { mergedTextStyle } from './editorTextEdit';
import type { TextClip } from './nativeEditorModel';
const families: Record<string, readonly [string, string]> = {
    'sans-serif': ['Helvetica', 'sans-serif'], Helvetica: ['Helvetica', 'sans-serif'],
    Arial: ['Arial', 'sans-serif'], Verdana: ['Verdana', 'sans-serif'], Georgia: ['Georgia', 'serif'],
    'Times New Roman': ['Times New Roman', 'serif'], 'Courier New': ['Courier New', 'monospace'], Impact: ['Impact', 'sans-serif-condensed'],
    serif: ['Times New Roman', 'serif'], monospace: ['Courier', 'monospace'],
};
export function platformFontFamily(font: string, os: string): string | undefined {
    const pair = Object.hasOwn(families, font) ? families[font] : undefined;
    return os === 'ios' ? pair?.[0] : os === 'android' ? pair?.[1] : undefined;
}
const rgba = (hex: string, opacity: number) => `rgba(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',')},${opacity})`;
export function editorTextPreviewStyle(style: TextClip['style'], size: number, os: string): TextStyle {
    const s = mergedTextStyle({ style }), k = 18 / (7.2 * size), shadow = s.shadowOpacity > 0;
    return {
        fontSize: 18, fontFamily: platformFontFamily(s.font, os), color: s.color, fontWeight: s.weight === 'bold' ? '700' : '400',
        fontStyle: s.italic ? 'italic' : 'normal', textDecorationLine: s.underline ? 'underline' : 'none', textAlign: s.align as TextStyle['textAlign'],
        letterSpacing: s.letterSpacing * k, lineHeight: 18 * s.lineHeight,
        backgroundColor: s.backgroundOpacity > 0 ? rgba(s.background, s.backgroundOpacity) : 'transparent',
        paddingHorizontal: s.backgroundOpacity > 0 ? 8 * k : 0,
        textShadowColor: shadow ? rgba(s.shadowColor, s.shadowOpacity) : 'transparent',
        textShadowOffset: { width: shadow ? s.shadowX * k : 0, height: shadow ? s.shadowY * k : 0 }, textShadowRadius: shadow ? s.shadowBlur * k : 0,
    };
}
