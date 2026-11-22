import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatEditorTransport } from '../src/components/beats/BeatEditorTransport';

let mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockBottomInset = 34;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ default: () => mockDimensions }));
jest.mock('react-native-safe-area-context', () => ({
    SafeAreaView: ({ children, edges, style, ...props }: any) => {
        const React = jest.requireActual('react');
        const Native = jest.requireActual('react-native');
        return React.createElement(Native.View, { ...props, edges, style: [style, { paddingBottom: edges?.includes('bottom') ? mockBottomInset : 0 }] }, children);
    },
}));
void [RN.View, RN.Text, RN.Pressable];

let root: Root;
const props = { playing: false, starting: false, locked: false, canUndo: true, canRedo: true,
    onUndo: jest.fn(), onRedo: jest.fn(), onPlay: jest.fn(), onMixer: jest.fn() };
const render = async () => { await act(async () => root.render(<BeatEditorTransport {...props} />)); };

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
    mockBottomInset = 34;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('large text uses a bounded horizontal toolbar with one rendered primary action', async () => {
    mockDimensions = { ...mockDimensions, width: 390, height: 667, fontScale: 3.12 };
    await render();
    const scroller = root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-accessible')[0];
    expect(scroller.props.horizontal).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-status')).toHaveLength(0);
    for (const id of ['beat-editor-history-controls', 'beat-editor-playback-controls']) {
        const group = root.container.queryAll(n => n.props.testID === id)[0];
        expect(RN.StyleSheet.flatten(group.props.style)).toMatchObject({ flex: 0, width: 'auto' });
    }
    const style = (id: string) => RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0].props.style);
    const primary = style('beat-editor-play').backgroundColor;
    for (const id of ['beat-editor-undo', 'beat-editor-redo', 'beat-editor-mixer']) expect(style(id).backgroundColor).not.toBe(primary);
});

test('regular width uses the row layout and applies the bottom safe-area edge', async () => {
    mockDimensions = { ...mockDimensions, width: 1024 };
    await render();
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-regular')).toHaveLength(1);
    const transport = root.container.queryAll(n => n.props.testID === 'beat-editor-transport')[0];
    expect(transport.props.edges).toEqual(['bottom']);
    expect(RN.StyleSheet.flatten(transport.props.style).paddingBottom).toBe(34);
});
