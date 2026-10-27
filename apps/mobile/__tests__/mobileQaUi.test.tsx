import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Text, Button, AppearanceContext } from '../src/components/ui';
import { EntryTile } from '../src/app/(app)/(tabs)/create';
import { DEFAULT_APPEARANCE, tokensForScheme } from '../src/theme';
import { useAnnouncement } from '../src/lib/useAnnouncement';
import { fontScaleCap } from '../src/lib/a11y';
import { MessageBubble } from '../src/components/chat/MessageBubble';

jest.mock('react-native', () => {
    const actual = jest.requireActual('react-native');
    return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(actual),
        useWindowDimensions: { enumerable: true, value: () => ({ width: 390, height: 844, scale: 3, fontScale: 3.12 }) },
    });
});
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({}), useLocalSearchParams: () => ({}), useFocusEffect: jest.fn() }));
jest.mock('../src/components/chat/DraftCards', () => ({ DraftCards: () => require('react').createElement(require('../src/components/ui').Button, { label: 'Use draft', onPress: jest.fn() }) }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
void [RN.View, RN.Text, RN.Pressable, RN.Image];
let root: Root;
beforeEach(() => { jest.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
const style = (node: any) => RN.StyleSheet.flatten(node.props.style);

test('Create tile uses the full row at largest system and app text size without truncating', async () => {
    await act(async () => root.render(<AppearanceContext value={{ ...DEFAULT_APPEARANCE, textSize: 'xl' }}>
        <EntryTile icon="squares" label="Templates" onPress={jest.fn()} />
    </AppearanceContext>));
    const tile = root.container.queryAll(n => n.props.accessibilityLabel === 'Templates')[0];
    expect(style(tile).width).toBe('100%');
    const label = tile.queryAll(n => n.children.includes('Templates'))[0];
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.maxFontSizeMultiplier).toBe(fontScaleCap('bodyStrong'));
});
test('every ui Text variant defaults to its policy cap', async () => {
    for (const variant of ['display', 'title1', 'title2', 'title3', 'body', 'bodyStrong', 'callout', 'footnote', 'caption', 'micro'] as const) {
        await act(async () => root.render(<Text variant={variant}>Readable</Text>));
        const text = root.container.queryAll(n => n.children.includes('Readable'))[0];
        expect(text.props.allowFontScaling).toBe(true);
        expect(text.props.maxFontSizeMultiplier).toBe(fontScaleCap(variant));
    }
});
test('iOS status announcements deduplicate rerenders but announce a later repeated state', async () => {
    const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    function Status({ value }: { value: string }) { useAnnouncement(value); return null; }
    for (const value of ['Saving', 'Saving', 'Saved', 'Saved', 'Saving']) await act(async () => root.render(<Status value={value} />));
    expect(announce.mock.calls.map(c => c[0])).toEqual(['Saved', 'Saving']);
});
test('disabled primary rich labels use tertiary ink on the surface without opacity', async () => {
    const settings = { ...DEFAULT_APPEARANCE, theme: 'light' as const };
    const p = tokensForScheme('light', settings);
    await act(async () => root.render(<AppearanceContext value={settings}><Button label="Buy" disabled><Text tone="onAccent">Buy</Text></Button></AppearanceContext>));
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button')[0];
    expect(style(button).backgroundColor).toBe(p.surface);
    expect(style(button).opacity ?? 1).toBe(1);
    expect(style(button.queryAll(n => n.children.includes('Buy'))[0]).color).toBe(p.textTertiary);
});
test('only message text is grouped; draft actions are siblings outside that accessible element', async () => {
    await act(async () => root.render(<MessageBubble message={{ id: 'm', role: 'assistant', content: 'A draft' }} sending={false} drafts={[{} as never]} />));
    const message = root.container.queryAll(n => n.props.accessibilityLabel === 'Assistant: A draft')[0];
    expect(message.props.accessible).toBe(true);
    expect(message.queryAll(n => n.props.accessibilityLabel === 'Use draft')).toHaveLength(0);
    expect(message.parent!.props.accessible).not.toBe(true);
    expect(message.parent!.queryAll(n => n.props.accessibilityLabel === 'Use draft')).toHaveLength(1);
});

test.each([1.3, 2, 0])('ui Text respects an explicit multiplier of %s', async cap => {
    await act(async () => root.render(<Text variant="title3" maxFontSizeMultiplier={cap}>Title</Text>));
    const text = root.container.queryAll(n => n.children.includes('Title'))[0];
    expect(text.props.maxFontSizeMultiplier).toBe(cap);
});
test('opening an editor with Saved status is silent, then announces changed status', async () => {
    const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    function Status({ value }: { value: string | null }) { useAnnouncement(value); return null; }
    for (const value of ['Saved', ' Saved ', 'Saved']) await act(async () => root.render(<Status value={value} />));
    expect(announce).not.toHaveBeenCalled();
    for (const value of ['Unsaved', 'Unsaved', 'Saving', 'Saved', null, 'Saved']) await act(async () => root.render(<Status value={value} />));
    expect(announce.mock.calls.map(c => c[0])).toEqual(['Unsaved', 'Saving', 'Saved', 'Saved']);
});
