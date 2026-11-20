import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { TITLE_STYLES } from '../../../app/veyrnox/_lib/editorPresets.mjs';
import { EditorTextOverlay } from '../src/components/editor/EditorTextOverlay';
import { TextStyleCatalog } from '../src/components/editor/tools/TextStyleCatalog';
import { AnimationPanel } from '../src/components/editor/tools/AnimationPanel';
import { useTextActions, type TextActions } from '../src/components/editor/tools/useTextActions';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { ACTIVE_LOCALES, CATALOGS, chooseLocale, t } from '../src/lib/i18n';
import { tokensForScheme } from '../src/theme';
import { webSequenceV3 } from './fixtures/webSequenceV3';

void [Text, View];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    chooseLocale('en');
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); chooseLocale('en'); });

test('Outlined tile has a light sample surface and a document-coloured outline', async () => {
    const preset = TITLE_STYLES.find(p => p.name === 'Outlined')!;
    const before = JSON.stringify(preset);
    await act(async () => root.render(<TextStyleCatalog onInsert={jest.fn()} />));
    const samples = root.container.queryAll(n => n.children.includes('Aa') && !!n.props.style);
    const sample = samples.find(n => StyleSheet.flatten(n.props.style).color === preset.style.color)!;
    expect(StyleSheet.flatten(sample.parent!.props.style).backgroundColor).toBe(tokensForScheme('light').surface);
    expect(StyleSheet.flatten(sample.props.style)).toMatchObject({
        color: preset.style.color, textShadowColor: preset.style.stroke,
        textShadowOffset: { width: 0, height: 0 }, textShadowRadius: preset.style.strokeWidth * 18 / (7.2 * preset.size),
    });
    expect(JSON.stringify(preset)).toBe(before);
});

test('Outlined playback overlay preserves fill and approximates its outline', async () => {
    const preset = TITLE_STYLES.find(p => p.name === 'Outlined')!;
    const item = { ...webSequenceV3().text[0], style: preset.style, size: preset.size };
    const before = JSON.stringify(item);
    await act(async () => root.render(<EditorTextOverlay item={item} />));
    const caption = root.container.queryAll(n => n.children.includes(item.text) && !!n.props.style)[0];
    expect(StyleSheet.flatten(caption.props.style)).toMatchObject({ color: '#000000', textShadowColor: '#ffffff',
        textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 1 });
    expect(JSON.stringify(item)).toBe(before);
});

test.each(['left', 'right'])('%s overlay alignment has horizontal room to take effect', async align => {
    const item = { ...webSequenceV3().text[0], style: { align } };
    await act(async () => root.render(<EditorTextOverlay item={item} />));
    const caption = root.container.queryAll(n => n.children.includes(item.text) && !!n.props.style)[0];
    expect(StyleSheet.flatten(caption.props.style)).toMatchObject({ textAlign: align, width: '84%' });
});

test.each([
    ['en', '1 frame · 0.03 seconds', '15 frames · 0.50 seconds'],
    ['de', '1 Frame · 0,03 s', '15 Frames · 0,50 s'],
])('%s animation duration renders localized singular frames and two decimal places', async (locale, singular, initial) => {
    chooseLocale(locale);
    const tl = webSequenceV3();
    await act(async () => root.render(<AnimationPanel selection={{ track: 'text', id: tl.text[0].id }} selected={tl.text[0]} />));
    const slider = () => root.container.queryAll(n => n.props.accessibilityRole === 'adjustable'
        && n.props.accessibilityLabel === t('editorText.duration'))[0];
    expect(slider().props.accessibilityValue.text).toBe(initial);
    for (let i = 0; i < 14; i++) {
        await act(async () => slider().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    }
    expect(slider().props.accessibilityValue).toMatchObject({ now: 1, text: singular });
    expect(root.container.queryAll(n => n.children.includes(singular)).length).toBeGreaterThan(0);
});

test.each(ACTIVE_LOCALES)('%s supplies every CLDR form for frame readouts', locale => {
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
        expect(CATALOGS[locale]?.[`editorText.framesSeconds.${category}`]).toContain('{count}');
    }
});

test.each(['ja', 'ko', 'zh'])('%s distinguishes style presets from the selected text style', locale => {
    chooseLocale(locale);
    expect(t('editorText.catalog')).not.toBe(t('editorText.style'));
});

test.each(['style', 'typography', 'applyAnimation', 'resetAnimation'] as const)('%s explains the required selection', async action => {
    const setProblem = jest.fn(), applyTimeline = jest.fn();
    let actions: TextActions;
    function Harness() {
        actions = useTextActions({ timeline: webSequenceV3(), selection: null, applyTimeline, setProblem,
            setSelection: jest.fn(), setSelections: jest.fn(), setTool: jest.fn(), frameStore: createFrameStore() });
        return null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
        if (action === 'style') actions.style('color', '#ffffff');
        else if (action === 'typography') actions.typography('italic', true);
        else if (action === 'applyAnimation') actions.applyAnimation('in', 'fade', {});
        else actions.resetAnimation();
    });
    expect(setProblem).toHaveBeenCalledWith(t(action === 'style' || action === 'typography'
        ? 'editor.selectatextlayeronthetimeline' : 'editorText.visualSelection'));
    expect(applyTimeline).not.toHaveBeenCalled();
});

test('playback retains the original unrelated media and empty-state lines', () => {
    const source = readFileSync(join(__dirname, '../src/components/editor/EditorPlayback.tsx'), 'utf8').split('\n');
    expect(source).toContain('        {active ? <EditorMediaPreview api={api} clip={active.clip} media={active.media} frameStore={frameStore} fps={timeline.fps} playing={playing} localUri={localMediaUris[active.media.id]} /> : null}');
    expect(source).toContain("        {!active && !caption ? <><Text style={styles.previewMark}>{t('editor.v')}</Text><Text style={styles.previewLabel}>{timeline.video.length ? t('editor.movetheplayheadontoavisualclip') : t('editor.previewEmpty')}</Text></> : null}");
});
