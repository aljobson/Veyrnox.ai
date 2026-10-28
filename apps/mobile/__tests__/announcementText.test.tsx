import { act } from 'react';
import { AccessibilityInfo, I18nManager, Platform, StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Text } from '../src/components/ui/Text';
import { TextField } from '../src/components/ui/TextField';

let root: Root;
const originalOS = Platform.OS, originalRTL = I18nManager.isRTL;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    jest.clearAllMocks();
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount()); jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: originalRTL });
});
test.each(['alert', 'assertive', 'polite'] as const)('%s mount/change announcements are deduplicated', async mode => {
    const props = mode === 'alert' ? { accessibilityRole: 'alert' as const } : { accessibilityLiveRegion: mode };
    await act(async () => root.render(<Text {...props}>First</Text>));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(mode === 'polite' ? 0 : 1);
    await act(async () => root.render(<Text {...props}>Second</Text>));
    await act(async () => root.render(<Text {...props}>Second</Text>));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(mode === 'polite' ? 1 : 2);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Second');
});
test('Android uses native announcements only', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    await act(async () => root.render(<Text accessibilityRole="alert" accessibilityLiveRegion="assertive">First</Text>));
    await act(async () => root.render(<Text accessibilityRole="alert" accessibilityLiveRegion="assertive">Second</Text>));
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});
test.each([false, true])('RTL text and input (multiline=%s) keep natural alignment and writing direction', async multiline => {
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: true });
    await act(async () => root.render(<><Text testID="text">مرحبا</Text><TextField testID="field" multiline={multiline} value="مرحبا" /></>));
    for (const id of ['text', 'field']) {
        const node = root.container.queryAll(n => n.props.testID === id)[0];
        const style = StyleSheet.flatten(node.props.style);
        expect(style.writingDirection).toBe('rtl'); expect(style.textAlign).toBeUndefined();
    }
});
