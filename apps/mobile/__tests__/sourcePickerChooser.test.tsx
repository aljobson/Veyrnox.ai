import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { SourcePicker, choose } from '../src/components/SourcePicker';
import { chooseLocale, t } from '../src/lib/i18n';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { uploadSource } from '../src/lib/uploads';
let mockOwner = 'A';
var mockListeners: Set<() => void>;
jest.mock('../src/lib/appCache', () => ({ ...jest.requireActual('../src/lib/appCache'), getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { (mockListeners ??= new Set()).add(fn); return () => mockListeners.delete(fn); } }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'Upload failed' }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Image, RN.ActivityIndicator];
let root: Root;
const renderedText = () => root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children).join('\n');
const onChange = jest.fn(), onBusy = jest.fn();
const asset = { canceled: false, assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fileSize: 123, width: 10, height: 10 }] } as const;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockOwner = 'A'; root = createRoot(); jest.mocked(uploadSource).mockResolvedValue('key'); });
afterEach(async () => { await act(async () => root.unmount()); chooseLocale('en'); });

test('the native chooser retains video dimensions and converts milliseconds to seconds', async () => {
    jest.mocked(launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///video.mp4', mimeType: 'video/mp4', fileSize: 1000, width: 1280, height: 720, duration: 5000 }] });
    expect(await choose('video')).toEqual({ uri: 'file:///video.mp4', mimeType: 'video/mp4', size: 1000, width: 1280, height: 720, durationSeconds: 5 });
});

test.each(['en', 'de', 'ar'])('%s renders reference duration and resolution hints', async locale => {
    chooseLocale(locale);
    await act(async () => root.render(<SourcePicker slot={{ slot: 'video', kind: 'video', label: 'Video', required: true, minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160 }} api={{} as any} onChange={onChange} onBusy={onBusy} />));
    const text = renderedText();
    expect(text).toContain(t('app.create.sources.video.mp4Hint'));
    expect(text).toContain(t('app.create.sources.secondsRange', { min: 3, max: 10 }));
    expect(text).toContain(t('app.create.sources.sideRange', { min: 720, max: 2160 }));
    expect(text).not.toContain(t('sourcePicker.uptoseconds', { value1: 10 }));
});

test.each(['audio', 'video'] as const)('an existing %s duration-only picker keeps its hint', async kind => {
    await act(async () => root.render(<SourcePicker slot={{ slot: kind, kind, label: kind, required: true, maxSeconds: 40 }} api={{} as any} onChange={onChange} onBusy={onBusy} />));
    expect(renderedText()).toContain(t('sourcePicker.uptoseconds', { value1: 40 }));
    expect(renderedText()).not.toContain(t('app.create.sources.video.mp4Hint'));
});

test.each([
    [{ duration: 2000, width: 1280, height: 720 }, 'sourceLimits.tooShort'],
    [{ duration: 5000, width: 640, height: 360 }, 'sourceLimits.resolution'],
])('a known invalid picked video %j never uploads', async (metadata, key) => {
    jest.mocked(launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///video.mp4', mimeType: 'video/mp4', fileSize: 1000, ...metadata }] });
    await act(async () => root.render(<SourcePicker slot={{ slot: 'video', kind: 'video', label: 'Video', required: true, minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160 }} api={{} as any} onChange={onChange} onBusy={onBusy} />));
    const button = root.container.queryAll(n => n.props.accessibilityLabel === 'Choose video for Video')[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }));
    expect(uploadSource).not.toHaveBeenCalled();
    expect(renderedText()).toContain(t(key));
});
test.each(['account', 'unmount', 'same', 'error'] as const)('pending native chooser: %s', async action => {
    let resolve!: (value: any) => void, reject!: (error: Error) => void;
    jest.mocked(launchImageLibraryAsync).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    await act(async () => root.render(<SourcePicker slot={{ slot: 'image', kind: 'image', label: 'Image', required: false }} api={{} as any} onChange={onChange} onBusy={onBusy} />));
    const button = root.container.queryAll(n => n.props.accessibilityLabel === 'Choose image for Image')[0];
    await act(async () => { button.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }); });
    if (action === 'account' || action === 'error') await act(async () => { mockOwner = 'B'; mockListeners.forEach(fn => fn()); });
    if (action === 'unmount') await act(async () => root.unmount());
    await act(async () => { if (action === 'error') reject(Error('chooser')); else resolve(asset); });
    expect(uploadSource).toHaveBeenCalledTimes(action === 'same' ? 1 : 0);
    if (action !== 'same') { expect(onChange).not.toHaveBeenCalled(); expect(onBusy).not.toHaveBeenCalledWith(true); }
    else expect(onChange).toHaveBeenLastCalledWith('key');
});
