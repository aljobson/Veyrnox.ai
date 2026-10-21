import * as ReactNative from 'react-native';
import { act } from 'react';
import { AccessibilityInfo, PanResponder, Platform } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { File, Paths } from 'expo-file-system';
import { DrawOnImage } from '../src/components/DrawOnImage';
import { resetCacheUser } from '../src/lib/appCache';
import { writeDrawing, deleteDrawFile } from '../src/lib/drawFiles';
import * as drawingModel from '../src/lib/drawOnImage';
import { exportDrawing } from '../src/lib/drawRender';
import type { ImageResizer, PreparedImage } from '../src/lib/chatAttach';

jest.mock('@shopify/react-native-skia', () => ({
    Canvas: jest.requireActual('react-native').View,
    Picture: () => null,
    Skia: {
        Data: { fromURI: jest.fn(async () => ({ dispose: jest.fn() })) },
        Image: { MakeImageFromEncoded: jest.fn(() => ({ width: () => 300, height: () => 200, dispose: jest.fn() })) },
        PictureRecorder: () => ({ beginRecording: () => ({ translate() {} }), finishRecordingAsPicture: () => ({ dispose: jest.fn() }), dispose() {} }),
    },
}));
jest.mock('../src/lib/drawRender', () => ({ drawOps: jest.fn(), exportDrawing: jest.fn(() => new Uint8Array([1, 2, 3])) }));
jest.mock('../src/lib/drawFiles', () => ({ writeDrawing: jest.fn(), deleteDrawFile: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

// Resolve native lazy getters before the per-test interaction timeout.
void [ReactNative.ActivityIndicator, ReactNative.Modal, ReactNative.Pressable, ReactNative.ScrollView, ReactNative.StyleSheet, ReactNative.Text, ReactNative.View];

let root: Root;
let onDone: jest.Mock;
let onCancel: jest.Mock;
let handlers: Parameters<typeof PanResponder.create>[0];
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const controls = (role: string, label: string) => root.container.queryAll(node => node.props.accessibilityRole === role && node.props.accessibilityLabel === label);
function control(label: string, role = 'button') { const found = controls(role, label); expect(found).toHaveLength(1); return found[0]; }
async function press(label: string) { await act(async () => control(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
const event = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } }) as any;
async function stroke() {
    await act(async () => {
        handlers.onPanResponderGrant!(event(50, 50), {} as any);
        handlers.onPanResponderMove!(event(100, 50), {} as any);
        handlers.onPanResponderRelease!(event(100, 50), {} as any);
    });
}
function jpeg() { const file = new File(Paths.cache, 'prepared-drawing.jpg'); if (!file.exists) file.create(); return file; }
async function render(resizer: ImageResizer = { prepare: async () => ({ uri: jpeg().uri, contentType: 'image/jpeg' }) }) {
    await act(async () => root.render(<DrawOnImage uri="file:///original.jpg" onCancel={onCancel} onDone={onDone} resizer={resizer} />));
    const layouts = root.container.queryAll(node => typeof node.props.onLayout === 'function');
    if (layouts.length) await act(async () => layouts[0].props.onLayout({ nativeEvent: { layout: { width: 300, height: 200, x: 0, y: 0 } } }));
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    jest.spyOn(PanResponder, 'create').mockImplementation(config => { handlers = config; return { panHandlers: {} } as any; });
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(writeDrawing).mockResolvedValue({ uri: 'file:///cache/veyrnox-draw/test.png', mimeType: 'image/png', size: 3 });
    onDone = jest.fn(); onCancel = jest.fn(); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

test('labelled controls expose disabled and selected states; pen enables Undo, Clear and Use', async () => {
    await render();
    expect(control('Pen').props.accessibilityState.selected).toBe(true);
    for (const label of ['Undo', 'Clear', 'Use drawing']) expect(control(label).props.accessibilityState.disabled).toBe(true);
    for (const label of ['Pen', 'Box', 'Erase', 'Yellow', 'Red', 'White', 'Cyan', 'Small', 'Medium', 'Large', 'Add box', 'Cancel']) control(label);
    await stroke();
    for (const label of ['Undo', 'Clear', 'Use drawing']) expect(control(label).props.accessibilityState.disabled).toBe(false);
    await press('Use drawing');
    expect(exportDrawing).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }));
});
test('Add box provides a non-gesture adjustable control with percent position and size', async () => {
    await render(); await press('Add box');
    expect(control('Newest box', 'adjustable').props.accessibilityValue.text).toContain('width 50%');
    await act(async () => control('Newest box', 'adjustable').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(control('Newest box', 'adjustable').props.accessibilityValue.text).toContain('width 60%');
    await act(async () => control('Newest box', 'adjustable').props.onAccessibilityAction({ nativeEvent: { actionName: 'moveRight' } }));
    expect(control('Newest box', 'adjustable').props.accessibilityValue.text).toContain('Left 25%');
});
test('a Box tap adds nothing; a real Box drag adds a box', async () => {
    await render(); await press('Box');
    await act(async () => {
        handlers.onPanResponderGrant!(event(50, 50), {} as any);
        handlers.onPanResponderRelease!(event(50, 50), {} as any);
    });
    expect(controls('adjustable', 'Newest box')).toHaveLength(0);
    expect(control('Use drawing').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
        handlers.onPanResponderGrant!(event(50, 50), {} as any);
        handlers.onPanResponderMove!(event(150, 120), {} as any);
        handlers.onPanResponderRelease!(event(150, 120), {} as any);
    });
    expect(control('Newest box', 'adjustable').props.accessibilityValue.text).toContain('width 33%');
    expect(control('Use drawing').props.accessibilityState.disabled).toBe(false);
});
test('Cancel deletes prepared JPEG, including a prepare resolving after Cancel', async () => {
    const pending = deferred<PreparedImage>();
    await render({ prepare: () => pending.promise });
    await press('Cancel');
    const file = jpeg();
    await act(async () => pending.resolve({ uri: file.uri, contentType: 'image/jpeg' }));
    expect(file.exists).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
});
test('prepared JPEG is released after decoding and on close', async () => {
    const file = jpeg(); await render(); await press('Cancel');
    expect(file.exists).toBe(false);
});
test('resize failure shows only the failure and Close control', async () => {
    await render({ prepare: async () => { throw new Error('resize_unavailable'); } });
    expect(root.container.queryAll(node => node.children.includes('Could not open this image for drawing.'))).toHaveLength(1);
    expect(controls('button', 'Use drawing')).toHaveLength(0);
    expect(controls('button', 'Pen')).toHaveLength(0);
    await press('Close'); expect(onCancel).toHaveBeenCalled();
});
test('a write resolving after account change deletes its PNG and never calls onDone', async () => {
    const pending = deferred<Awaited<ReturnType<typeof writeDrawing>>>();
    jest.mocked(writeDrawing).mockReturnValueOnce(pending.promise);
    await render(); await stroke(); await press('Use drawing');
    await act(async () => resetCacheUser());
    const file = { uri: 'file:///cache/veyrnox-draw/late.png', mimeType: 'image/png', size: 3 };
    await act(async () => pending.resolve(file));
    expect(deleteDrawFile).toHaveBeenCalledWith(file.uri);
    expect(onDone).not.toHaveBeenCalled();
});
test.each(['ios', 'android'] as const)('point limit announces once on %s using its platform channel', async platform => {
    jest.replaceProperty(Platform, 'OS', platform);
    await render();
    jest.spyOn(drawingModel, 'pointCount').mockReturnValue(drawingModel.POINT_LIMIT);
    await stroke(); await stroke();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(platform === 'ios' ? 1 : 0);
    if (platform === 'ios') expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Drawing limit reached. Undo or clear marks to continue.');
    else expect(root.container.queryAll(node => node.props.accessibilityLiveRegion === 'polite')).toHaveLength(1);
});
test.each(['ios', 'android'] as const)('export failure uses the %s announcement channel', async platform => {
    jest.replaceProperty(Platform, 'OS', platform);
    jest.mocked(exportDrawing).mockImplementationOnce(() => { throw new Error('draw_export_failed'); });
    await render(); await stroke(); await press('Use drawing');
    expect(onDone).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(platform === 'ios' ? 1 : 0);
    if (platform === 'ios') expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Could not save your drawing. Try again.');
});
