import * as ReactNative from 'react-native';
jest.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `drawing-${++id}` }; });
import { act } from 'react';
import { View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { SourcePicker } from '../src/components/SourcePicker';
import { loadDrawOnImage } from '../src/lib/drawLoader';
import { writeDrawing } from '../src/lib/drawFiles';
import { resetCacheUser } from '../src/lib/appCache';
import { uploadSource } from '../src/lib/uploads';
import type { ApiClient } from '../src/lib/api';
import type { DrawOnImageProps } from '../src/components/DrawOnImage';

jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'Upload failed' }));
jest.mock('../src/lib/drawLoader', () => ({ loadDrawOnImage: jest.fn() }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: (props: any) => {
    const React = require('react'); const { View } = require('react-native');
    return React.createElement(View, { ...props, accessibilityLabel: 'mock-library' });
} }));
const slot = { slot: 'image', kind: 'image', label: 'Image', required: true } as const;
const api = {} as ApiClient;
const initial = { uri: 'file:///photo.jpg', mimeType: 'image/jpeg', size: 123 };
// Resolve native lazy getters before the per-test interaction timeout.
void [ReactNative.ActivityIndicator, ReactNative.Image, ReactNative.Pressable, ReactNative.ScrollView, ReactNative.StyleSheet, ReactNative.Text, ReactNative.TextInput, ReactNative.View];

let root: Root;
let change: jest.Mock;
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
async function press(label: string, index = 0) { await act(async () => button(label)[index].props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 })); }
const editors = () => root.container.queryAll(n => n.props.accessibilityLabel === 'mock-editor');
async function finish(index = 0) {
    const file = await writeDrawing(new Uint8Array([1, 2, 3]));
    await act(async () => editors()[index].props.onDone(file));
    return file;
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    jest.mocked(loadDrawOnImage).mockReturnValue((props: DrawOnImageProps) => <View {...props} accessibilityLabel="mock-editor" />);
    jest.mocked(uploadSource).mockResolvedValue('uploads/original');
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: initial.uri, mimeType: initial.mimeType, fileSize: initial.size, width: 10, height: 10 }] });
    change = jest.fn(); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); resetCacheUser(); });
async function render(drawable = true, local = true) {
    await act(async () => root.render(<SourcePicker slot={slot} api={api} onChange={change} onBusy={() => {}} onLibrary={() => {}} drawable={drawable} initial={local ? initial : null} />));
}
test('draw appears only for drawable, ready local files and an available native screen', async () => {
    await render(true, false); expect(button('Draw on image')).toHaveLength(0);
    await press('Choose image for Image'); expect(button('Draw on image')).toHaveLength(1);
    await press('Remove Image'); expect(button('Draw on image')).toHaveLength(0);
});
test('old binary hides draw and still uploads normally', async () => {
    jest.mocked(loadDrawOnImage).mockReturnValue(null);
    await render(); expect(button('Draw on image')).toHaveLength(0);
    expect(change).toHaveBeenLastCalledWith('uploads/original');
});
test('Library choice is never drawable', async () => {
    await render(true, false);
    const library = root.container.queryAll(n => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel).includes('Library'));
    expect(library).toHaveLength(1);
    await act(async () => library[0].props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }));
    const chooser = root.container.queryAll(n => n.props.accessibilityLabel === 'mock-library')[0];
    await act(async () => chooser.props.onPick({ jobId: 'library-job', name: 'Creation' }));
    expect(button('Draw on image')).toHaveLength(0);
});
test('without drawable the original labels and ready/remove behavior stay unchanged', async () => {
    await render(false, false);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button').map(n => n.props.accessibilityLabel)).toEqual(['Choose image for Image', 'Choose image from your Library for Image']);
    await press('Choose image for Image');
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button').map(n => n.props.accessibilityLabel)).toEqual(['Remove Image']);
    expect(loadDrawOnImage).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes('Ready'))).toHaveLength(1);
});
test('finished PNG uses the existing upload path and is released on remove', async () => {
    await render(); await press('Draw on image');
    jest.mocked(uploadSource).mockResolvedValueOnce('uploads/drawing');
    const file = await finish();
    expect(uploadSource).toHaveBeenLastCalledWith(api, file, 'image/png', expect.any(Function), expect.any(AbortSignal));
    expect(change).toHaveBeenLastCalledWith('uploads/drawing');
    expect(new File(file.uri).exists).toBe(true);
    await press('Remove Image'); expect(new File(file.uri).exists).toBe(false);
});
test('two mounted pickers retain independent files and both can reopen their drawing', async () => {
    await act(async () => root.render(<View>{['A', 'B'].map(key => <SourcePicker key={key} slot={slot} api={api} drawable initial={initial} onChange={change} onBusy={() => {}} />)}</View>));
    await press('Draw on image', 0); const a = await finish();
    await press('Draw on image', 1); const b = await finish();
    expect(new File(a.uri).exists).toBe(true); expect(new File(b.uri).exists).toBe(true);
    await press('Draw on image', 0); expect(editors()[0].props.uri).toBe(a.uri);
    await act(async () => editors()[0].props.onCancel());
    await press('Draw on image', 1); expect(editors()[0].props.uri).toBe(b.uri);
    await act(async () => root.unmount());
    expect(new File(a.uri).exists).toBe(false); expect(new File(b.uri).exists).toBe(false);
});
test('replacement releases the previous drawing; account change removes the new key and preview', async () => {
    await render(); await press('Draw on image'); const a = await finish();
    await press('Draw on image'); const b = await finish();
    expect(new File(a.uri).exists).toBe(false);
    await act(async () => resetCacheUser());
    expect(new File(b.uri).exists).toBe(false);
    expect(change).toHaveBeenLastCalledWith(undefined);
    expect(button('Draw on image')).toHaveLength(0);
    expect(button('Choose image for Image')).toHaveLength(1);
});
test.each(['unmount', 'account'] as const)('late onDone after %s discards the file', async reason => {
    await render(); await press('Draw on image');
    const done = editors()[0].props.onDone;
    await act(async () => { if (reason === 'unmount') root.unmount(); else resetCacheUser(); });
    const file = await writeDrawing(new Uint8Array([1]));
    const count = jest.mocked(uploadSource).mock.calls.length;
    await act(async () => done(file));
    expect(new File(file.uri).exists).toBe(false);
    expect(uploadSource).toHaveBeenCalledTimes(count);
});
