import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatAiPanelLayout } from '../src/components/beats/ai/BeatAiPanel';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({}) }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

void [RN.View, RN.ScrollView, RN.TextInput];

let root: Root;
let mounts = 0;
let unmounts = 0;

function DraftPrompt() {
    const [value, setValue] = useState('');
    const [focused, setFocused] = useState(false);
    useEffect(() => {
        mounts++;
        return () => { unmounts++; };
    }, []);
    return <RN.TextInput testID="stable-ai-prompt" value={value} onChangeText={setValue}
        onFocus={() => setFocused(true)} accessibilityState={{ selected: focused }} />;
}

const panel = (compact: boolean, composerFirst = false, magicExpanded = false) => <BeatAiPanelLayout compact={compact}
    composerFirst={composerFirst} magicExpanded={magicExpanded}
    chrome={<RN.View testID="ai-chrome" />}
    context={<RN.View testID="ai-context" />}
    composer={<DraftPrompt />}
    magicBar={<RN.View testID="ai-magic" />} />;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    mounts = 0;
    unmounts = 0;
});
afterEach(async () => { await act(async () => root.unmount()); });

test('compact keyboard transition keeps the same focused AI prompt and draft', async () => {
    await act(async () => root.render(panel(false)));
    const before = root.container.queryAll(node => node.props.testID === 'stable-ai-prompt')[0];
    await act(async () => {
        before.props.onChangeText('warm analog bass');
        before.props.onFocus();
    });

    await act(async () => root.render(panel(true, true)));
    const after = root.container.queryAll(node => node.props.testID === 'stable-ai-prompt')[0];
    expect(after).toBe(before);
    expect(after.props.value).toBe('warm analog bass');
    expect(after.props.accessibilityState.selected).toBe(true);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    const slots = root.container.queryAll(node => ['music-ai-chrome-slot', 'music-ai-context-slot', 'music-ai-composer-slot', 'music-ai-magic-slot'].includes(node.props.testID));
    expect(slots.map(node => node.props.testID)).toEqual(['music-ai-composer-slot', 'music-ai-chrome-slot', 'music-ai-context-slot', 'music-ai-magic-slot']);
    const styleEntries = (style: unknown): Record<string, unknown>[] => (Array.isArray(style) ? style.flat(Infinity) : [style])
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    for (const testID of ['music-ai-chrome-slot', 'music-ai-context-slot', 'music-ai-composer-slot']) {
        const slot = root.container.queryAll(node => node.props.testID === testID)[0];
        expect(styleEntries(slot.props.style).some(entry => entry.display === 'none')).toBe(false);
    }
    const magicSlot = root.container.queryAll(node => node.props.testID === 'music-ai-magic-slot')[0];
    expect(styleEntries(magicSlot.props.style)).toEqual(expect.arrayContaining([expect.objectContaining({ display: 'none' })]));

    await act(async () => root.render(panel(true, true, true)));
    const expandedMagicSlot = root.container.queryAll(node => node.props.testID === 'music-ai-magic-slot')[0];
    expect(styleEntries(expandedMagicSlot.props.style).some(entry => entry.display === 'none')).toBe(false);
    expect(expandedMagicSlot.props.accessibilityElementsHidden).toBe(false);
    expect(root.container.queryAll(node => node.props.testID === 'ai-magic')).toHaveLength(1);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
});
