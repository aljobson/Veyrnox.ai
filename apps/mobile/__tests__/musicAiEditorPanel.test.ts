import fs from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'test-renderer';
import * as RN from 'react-native';
import { BeatAiPanelLayout } from '../src/components/beats/ai/BeatAiPanel';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({}) }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

const source = fs.readFileSync(path.join(__dirname, '../src/components/beats/ai/BeatAiPanel.tsx'), 'utf8');

test('AI music editing is an inline composer with always-visible icon operations and retry', () => {
    expect(source).toContain('testID="music-ai-editor"');
    expect(source).toContain('testID="music-ai-actions"');
    expect(source).not.toContain('testID="music-ai-context"');
    expect(source).toContain("icon={action.icon} iconOnly");
    expect(source).toContain('accessibilityState={{ selected: action.op === op }}');
    expect(source).toContain('embedded disabled={disabled} />');
    expect(source).toContain('testID="music-ai-retry"');
    for (const icon of ['magicWand', 'waveform', 'crosshair', 'arrowsHorizontal', 'scissors']) {
        expect(source).toContain(`icon: '${icon}'`);
    }
    expect(source).toContain('testID={`music-ai-${action.op}`}');
    expect(source).not.toContain('<BeatModal');
    expect(source).toContain('viewport: { flexGrow: 0, flexShrink: 1, minHeight: 0 }');
    expect(source).toContain('testID="music-ai-composer-slot"');
    expect(source).toContain('const composer = view.open ? <BeatAiSheet');
    expect(source).toContain('magicHidden && s.hidden');
    expect(source).not.toContain('compact && view.open ? <BeatAiSheet');
    expect(source).toContain('testID="music-ai-compact-context"');
    expect(source).toContain('view.rows.map(row => <Button key={row.key} testID={`music-ai-resume-context-${row.key}`}');
    expect(source).toContain('testID="music-ai-magic-toggle"');
    expect(source).toContain('accessibilityState={{ expanded: compactMagicOpen }}');
});

test('compact AI keeps operations, close, resume and error context visible around the stable composer slot', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    await act(async () => root.render(createElement(BeatAiPanelLayout, {
        compact: true,
        chrome: createElement(RN.View, null,
            createElement(RN.ScrollView, { testID: 'music-ai-actions' }),
            createElement(RN.Pressable, { testID: 'music-ai-close' })),
        context: createElement(RN.View, null,
            createElement(RN.Pressable, { testID: 'music-ai-resume-context' }),
            createElement(RN.Text, { testID: 'music-ai-error-context' }, 'Error')),
        composer: createElement(RN.View, { testID: 'stable-beat-ai-sheet-slot' }),
        magicBar: createElement(RN.View, { testID: 'secondary-magic-content' }),
    })));
    for (const id of ['music-ai-actions', 'music-ai-close', 'music-ai-resume-context', 'music-ai-error-context', 'stable-beat-ai-sheet-slot']) {
        expect(root.container.queryAll(node => node.props.testID === id)).toHaveLength(1);
    }
    const styleEntries = (style: unknown): Record<string, unknown>[] => (Array.isArray(style) ? style.flat(Infinity) : [style])
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    for (const id of ['music-ai-chrome-slot', 'music-ai-context-slot', 'music-ai-composer-slot']) {
        const slot = root.container.queryAll(node => node.props.testID === id)[0];
        expect(styleEntries(slot.props.style).some(entry => entry.display === 'none')).toBe(false);
    }
    const magicSlot = root.container.queryAll(node => node.props.testID === 'music-ai-magic-slot')[0];
    expect(styleEntries(magicSlot.props.style)).toEqual(expect.arrayContaining([expect.objectContaining({ display: 'none' })]));
    await act(async () => root.render(createElement(BeatAiPanelLayout, {
        compact: true,
        magicExpanded: true,
        chrome: createElement(RN.View, { testID: 'music-ai-actions' }),
        context: createElement(RN.View, { testID: 'music-ai-compact-context' }),
        composer: createElement(RN.View, { testID: 'stable-beat-ai-sheet-slot' }),
        magicBar: createElement(RN.View, { testID: 'secondary-magic-content' }),
    })));
    const expandedMagicSlot = root.container.queryAll(node => node.props.testID === 'music-ai-magic-slot')[0];
    expect(styleEntries(expandedMagicSlot.props.style).some(entry => entry.display === 'none')).toBe(false);
    expect(root.container.queryAll(node => node.props.testID === 'secondary-magic-content')).toHaveLength(1);
    await act(async () => root.unmount());
});
