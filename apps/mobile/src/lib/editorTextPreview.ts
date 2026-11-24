import type { TextStyle, ViewStyle } from 'react-native';
import { mergedTextStyle } from './editorTextEdit';
import type { TextClip } from './nativeEditorModel';
const families: Record<string, readonly [string, string]> = {
    'sans-serif': ['Helvetica', 'sans-serif'], Helvetica: ['Helvetica', 'sans-serif'],
    Arial: ['Arial', 'sans-serif'], Verdana: ['Verdana', 'sans-serif'], Georgia: ['Georgia', 'serif'],
    'Times New Roman': ['Times New Roman', 'serif'], 'Courier New': ['Courier New', 'monospace'], Impact: ['Impact', 'sans-serif-condensed'],
    serif: ['Times New Roman', 'serif'], monospace: ['Courier', 'monospace'],
};
export function platformFontFamily(font: string, os: string): string | undefined {
    if (/^VXFont_[a-f0-9]{64}$/.test(font)) return font;
    const pair = Object.hasOwn(families, font) ? families[font] : undefined;
    return os === 'ios' ? pair?.[0] : os === 'android' ? pair?.[1] : undefined;
}
const rgba = (hex: string, opacity: number) => `rgba(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',')},${opacity})`;
export function editorTextPreviewStyle(style: TextClip['style'], size: number, os: string, options: { outline?: boolean; customFontReady?: boolean } = {}): TextStyle {
    const s = mergedTextStyle({ style }), k = 18 / (7.2 * size), shadow = s.shadowOpacity > 0;
    const outline = options.outline && s.strokeWidth > 0 && s.shadowOpacity === 0;
    const custom = /^VXFont_[a-f0-9]{64}$/.test(s.font), fontFamily = custom && !options.customFontReady ? undefined : platformFontFamily(s.font, os);
    return {
        fontSize: 18, fontFamily, color: s.color, fontWeight: custom && options.customFontReady ? '400' : s.weight === 'bold' ? '700' : '400',
        fontStyle: custom && options.customFontReady ? 'normal' : s.italic ? 'italic' : 'normal', textDecorationLine: s.underline ? 'underline' : 'none',
        textAlign: s.align as TextStyle['textAlign'],
        letterSpacing: s.letterSpacing * k, lineHeight: 18 * s.lineHeight,
        backgroundColor: s.backgroundOpacity > 0 ? rgba(s.background, s.backgroundOpacity) : 'transparent',
        paddingHorizontal: s.backgroundOpacity > 0 ? 8 * k : 0,
        textShadowColor: shadow ? rgba(s.shadowColor, s.shadowOpacity) : outline ? s.stroke : 'transparent',
        textShadowOffset: { width: shadow ? s.shadowX * k : 0, height: shadow ? s.shadowY * k : 0 },
        textShadowRadius: shadow ? s.shadowBlur * k : outline ? s.strokeWidth * k : 0,
    };
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** Phone preview geometry for the canonical centre-anchored text coordinates. */
export function editorTextOverlayStyles(item: Pick<TextClip, 'x' | 'y' | 'size' | 'style'>, os: string,
    options: { outline?: boolean; customFontReady?: boolean } = {}): { wrapper: ViewStyle; text: TextStyle } {
    const base = editorTextPreviewStyle(item.style, item.size, os, options), fontSize = Math.max(8, Math.min(120, item.size * 3));
    const factor = fontSize / 18;
    return {
        wrapper: { position: 'absolute', width: '84%', left: `${clamp(item.x) * 100 - 42}%`, top: `${clamp(item.y) * 100}%`, marginTop: -fontSize / 2, direction: 'ltr' },
        text: { ...base, fontSize, lineHeight: typeof base.lineHeight === 'number' ? base.lineHeight * factor : undefined,
            letterSpacing: typeof base.letterSpacing === 'number' ? base.letterSpacing * factor : undefined },
    };
}
