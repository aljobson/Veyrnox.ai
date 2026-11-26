import { Platform } from 'react-native';

var mockNativeModule: { pickColor?(initial: string): Promise<string | null> } | null;
jest.mock('../src/lib/editorMedia/native', () => ({ optionalEditorMediaModule: () => mockNativeModule }));

import { nativeColorPickerAvailable, pickNativeColor } from '../src/lib/nativeColorPicker';

const originalPlatform = Platform.OS;

beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockNativeModule = null;
});

afterAll(() => { Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }); });

test('reports unavailable when the installed binary has no native picker', async () => {
    expect(nativeColorPickerAvailable()).toBe(false);
    await expect(pickNativeColor('#FFFFFF')).resolves.toBeNull();
});

test('normalizes a valid native picker result and keeps a dismissed picker unchanged', async () => {
    const pickColor = jest.fn().mockResolvedValueOnce('#12ab34').mockResolvedValueOnce(null);
    mockNativeModule = { pickColor };
    expect(nativeColorPickerAvailable()).toBe(true);
    await expect(pickNativeColor('#FFFFFF')).resolves.toBe('#12AB34');
    await expect(pickNativeColor('#12AB34')).resolves.toBeNull();
});

test('rejects malformed native results and hides the native capability off iOS', async () => {
    mockNativeModule = { pickColor: jest.fn().mockResolvedValue('display-p3') };
    await expect(pickNativeColor('#FFFFFF')).resolves.toBeNull();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    expect(nativeColorPickerAvailable()).toBe(false);
});
