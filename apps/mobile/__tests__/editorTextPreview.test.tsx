import { act } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { createRoot, type TestNode } from 'test-renderer';
import { platformFontFamily, editorTextPreviewStyle } from '../src/lib/editorTextPreview';
import { PlaybackPreview } from '../src/components/editor/EditorPlayback';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { TEXT_FONTS } from '../../../app/veyrnox/_lib/editorTextStyle.mjs';
import { TITLE_STYLES } from '../../../app/veyrnox/_lib/editorPresets.mjs';
import { webSequenceV3 } from './fixtures/webSequenceV3';
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
void [Text, View];
const fonts = [
    ['sans-serif', 'Helvetica', 'sans-serif'], ['serif', 'Times New Roman', 'serif'], ['monospace', 'Courier', 'monospace'],
    ['Arial', 'Arial', 'sans-serif'], ['Helvetica', 'Helvetica', 'sans-serif'], ['Verdana', 'Verdana', 'sans-serif'],
    ['Georgia', 'Georgia', 'serif'], ['Times New Roman', 'Times New Roman', 'serif'], ['Courier New', 'Courier New', 'monospace'],
    ['Impact', 'Impact', 'sans-serif-condensed'],
];
test('font table covers every web font', () => expect(fonts.map(f => f[0])).toEqual(TEXT_FONTS));
test.each(fonts)('%s maps by platform', (font, ios, android) => {
    expect(platformFontFamily(font, 'ios')).toBe(ios); expect(platformFontFamily(font, 'android')).toBe(android);
});
const customFamily = `VXFont_${'a'.repeat(64)}`;
test('a verified custom family is passed through on both native platforms', () => {
    expect(platformFontFamily(customFamily, 'ios')).toBe(customFamily); expect(platformFontFamily(customFamily, 'android')).toBe(customFamily);
    expect(editorTextPreviewStyle({ font: customFamily }, 6, 'ios', { customFontReady: true }).fontFamily).toBe(customFamily);
    expect(editorTextPreviewStyle({ font: customFamily }, 6, 'ios').fontFamily).toBeUndefined();
});
test.each(['missing', 'VXFont_short', `VXFont_${'A'.repeat(64)}`, `Other_${'a'.repeat(64)}`])('%s uses the system fallback', font => {
    expect(platformFontFamily(font, 'ios')).toBeUndefined(); expect(platformFontFamily(font, 'android')).toBeUndefined();
});
test('defaults override every legacy caption style', () => {
    expect(editorTextPreviewStyle(undefined, 6, 'ios')).toMatchObject({ color: '#ffffff', fontSize: 18, fontWeight: '700',
        textAlign: 'center', backgroundColor: 'transparent', textShadowColor: 'transparent', textShadowRadius: 0,
        textDecorationLine: 'none', fontStyle: 'normal', paddingHorizontal: 0 });
});
test.each(['Retro pop', 'Serif quote', 'Minimal subtitle', 'Neon heading'])('%s previews document units relative to 18pt', name => {
    const p = TITLE_STYLES.find(p => p.name === name)!, s = editorTextPreviewStyle(p.style, p.size, 'ios'), k = 18 / (7.2 * p.size);
    expect(s.color).toBe(p.style.color);
    if (name === 'Retro pop') expect(s).toMatchObject({ textShadowColor: 'rgba(50,214,197,1)', textShadowOffset: { width: 5 * k, height: 5 * k }, textShadowRadius: 0 });
    if (name === 'Serif quote') { expect(s.fontStyle).toBe('italic'); expect(s.lineHeight).toBeCloseTo(25.2); expect(s.textShadowColor).toBe('rgba(0,0,0,0.6)'); }
    if (name === 'Minimal subtitle') expect(s).toMatchObject({ backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8 * k });
    if (name === 'Neon heading') expect(s).toMatchObject({ textShadowColor: 'rgba(50,214,197,1)', textShadowRadius: 12 * k });
});
test('underline and letter spacing are drawn', () => {
    expect(editorTextPreviewStyle({ underline: true, letterSpacing: 2 }, 5, 'ios')).toMatchObject({ textDecorationLine: 'underline', letterSpacing: 1 });
});
test('PlaybackPreview renders the active styled clip and preserves fallback choice', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(), tl = webSequenceV3(), preset = TITLE_STYLES.find(p => p.name === 'Serif quote')!;
    tl.text[0] = { ...tl.text[0], style: preset.style, size: preset.size };
    const store = createFrameStore(10);
    try {
        await act(async () => root.render(<PlaybackPreview frameStore={store} timeline={tl} api={{ request: jest.fn() }} playing={false} localMediaUris={{}} fontReady={() => true} />));
        const textContent = (node: TestNode): string => typeof node === 'string' ? node : node.children.map(textContent).join('');
        const caption = () => root.container.queryAll(n => textContent(n) === 'Hello world' && !!n.props.style,
            { matchDeepestOnly: true })[0];
        expect(StyleSheet.flatten(caption().props.style)).toMatchObject(editorTextPreviewStyle(preset.style, preset.size, Platform.OS));
        await act(async () => store.set(1000)); expect(caption()).toBeDefined();
    } finally { await act(async () => root.unmount()); }
});
test('PlaybackPreview applies a verified custom family to the text overlay', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(), tl = webSequenceV3(), store = createFrameStore(10);
    tl.text[0] = { ...tl.text[0], style: { ...tl.text[0].style, font: customFamily } };
    try {
        await act(async () => root.render(<PlaybackPreview frameStore={store} timeline={tl} api={{ request: jest.fn() }} playing={false} localMediaUris={{}} fontReady={() => true} />));
        const textContent = (node: TestNode): string => typeof node === 'string' ? node : node.children.map(textContent).join('');
        const caption = root.container.queryAll(node => textContent(node) === 'Hello world' && !!node.props.style, { matchDeepestOnly: true })[0];
        expect(StyleSheet.flatten(caption.props.style).fontFamily).toBe(customFamily);
    } finally { await act(async () => root.unmount()); }
});
