import { act } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { ComponentProps } from 'react';
import { ClipFinderPanel, type ClipFinderPanelRow } from '../src/components/editor/tools/ClipFinderPanel';
void [Pressable, Text, View];

jest.mock('../src/lib/i18n', () => {
    const messages = jest.requireActual('../src/lib/i18n/messages/en/editorClips').default as Record<string, string>;
    const fill = (value: string, vars?: Record<string, string | number>) => value.replace(/\{(\w+)\}/g, (slot, key) => vars?.[key] === undefined ? slot : String(vars[key]));
    return {
        formatNumber: (value: number, decimals = 0) => value.toFixed(decimals), getLocale: () => 'en',
        t: (key: string, vars?: Record<string, string | number>) => fill(messages[key] ?? key, vars),
        plural: (key: string, count: number, vars?: Record<string, string | number>) => fill(messages[`${key}.${count === 1 ? 'one' : 'other'}`] ?? key, { count, ...vars }),
    };
});
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));

let root: Root;
const onFind = jest.fn(), onCancel = jest.fn(), onToggle = jest.fn(), onPreview = jest.fn(), onApply = jest.fn();
const rows: readonly ClipFinderPanelRow[] = Array.from({ length: 5 }, (_, index): ClipFinderPanelRow => ({ id: `pick-${index + 1}`,
    rank: index + 1, start: index * 6, end: index * 6 + 5, startFrame: index * 180, endFrame: index * 180 + 150,
    seconds: 5, ticked: index < 3,
    reasons: index ? ['continuous-shot'] : ['cut-aligned', 'lively-audio'] }));
const base = { availability: 'available' as const, blocker: null, status: 'done' as const, progress: 1, fps: 30, rows, error: null, hadAudio: true,
    previewingId: null, onFind, onCancel, onToggle, onPreview, onApply };
async function render(props: Partial<ComponentProps<typeof ClipFinderPanel>> = {}) { await act(async () => root.render(<ClipFinderPanel {...base} {...props} />)); }
const control = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function')[0];
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('shows five ranked results with top three selected and controls outside the summary', async () => {
    await render();
    const toggles = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox');
    expect(toggles).toHaveLength(5);
    expect(toggles.map(node => node.props.accessibilityState.checked)).toEqual([true, true, true, false, false]);
    const summary = root.container.queryAll(node => node.props.accessibilityRole === 'summary')[0];
    expect(summary.props.accessibilityLabel).toBe('5 suggestions. 3 selected.');
    expect(toggles.every(node => node.parent?.props.accessible !== true)).toBe(true);
    expect(control('Add 3 clips to timeline')).toBeDefined();
});

test('keeps checkbox and preview separate and exposes pause state', async () => {
    await render({ previewingId: 'pick-1' });
    const first = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox')[0];
    expect(first.props.accessibilityLabel).toContain('Top pick, 0.0s to 5.0s, 5.0 seconds. Starts and ends on cuts. Lively audio');
    await act(async () => first.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    await act(async () => control('Pause suggestion 1').props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onToggle).toHaveBeenCalledWith('pick-1');
    expect(onPreview).toHaveBeenCalledWith('pick-1');
});

test('progress is determinate and cancellable while unavailable state stays visible', async () => {
    await render({ status: 'reading-sound', progress: 0.42, rows: [] });
    const progress = root.container.queryAll(node => node.props.accessibilityRole === 'progressbar')[0];
    expect(progress.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 42, text: 'Reading sound… 42%' });
    await act(async () => control('Cancel').props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onCancel).toHaveBeenCalled();
    await render({ availability: 'unsupported', status: 'idle', rows: [] });
    expect(root.container.queryAll(node => node.children.includes('Clip Finder is not available on this device yet.'))).toHaveLength(1);
    expect(control('Find clips').props.accessibilityState.disabled).toBe(true);
});

test('silent and zero-selection states explain the result without changing the apply action', async () => {
    await render({ hadAudio: false, rows: rows.map(row => ({ ...row, ticked: false })) });
    expect(root.container.queryAll(node => node.children.includes('This clip has no sound, so loudness was not used.'))).toHaveLength(1);
    expect(root.container.queryAll(node => node.children.includes('Select at least one clip.'))).toHaveLength(1);
    expect(control('Add clips to timeline').props.accessibilityState.disabled).toBe(true);
});
