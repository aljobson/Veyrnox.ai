import type { ReactElement } from 'react';
import { AuthProviderButton } from '../src/components/ui/AuthProviderButton';
import * as Apple from 'expo-apple-authentication';
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('../src/components/ui/AppearanceContext', () => ({
    themedStyles: (fn: Function) => fn,
    useThemedStyles: (fn: Function) => fn({}, {}, mockScheme),
    useAppearance: () => ({ scheme: mockScheme }),
}));
jest.mock('../src/components/ui/Button', () => ({ Button: 'MockButton' }));
jest.mock('expo-apple-authentication', () => ({
    AppleAuthenticationButton: 'NativeApple',
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { BLACK: 2, WHITE: 3 },
}));
function render(nativeAvailable: boolean, consent: boolean, busy: boolean, onPress = jest.fn()) {
    const element = AuthProviderButton({ provider: 'apple', consent, busy, nativeAvailable, onPress }) as ReactElement<any>;
    const callback = nativeAvailable ? element.props.children.props.onPress : element.props.onPress;
    return { element, callback, onPress };
}
test.each([true, false])('Apple callback protects nativeAvailable=%s even when visually bypassed', (native) => {
    for (const [consent, busy] of [
        [false, false],
        [true, true],
        [false, true],
    ]) {
        const { callback, onPress } = render(native, consent, busy);
        callback();
        expect(onPress).not.toHaveBeenCalled();
    }
    const ready = render(native, true, false);
    ready.callback();
    expect(ready.onPress).toHaveBeenCalledTimes(1);
});
test('native blocked wrapper owns accessibility and hides the unconditional native callback', () => {
    const { element } = render(true, false, false);
    expect(element.props).toMatchObject({ pointerEvents: 'none', accessible: true, accessibilityRole: 'button', accessibilityState: { disabled: true }, style: { opacity: 0.4 } });
    expect(element.props.children.props).toMatchObject({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
        cornerRadius: 14,
        style: { height: 52, width: '100%' },
    });
});
test('native Apple button switches style with scheme without a reload', () => {
    mockScheme = 'light';
    expect(render(true, true, false).element.props.children.props.buttonStyle).toBe(Apple.AppleAuthenticationButtonStyle.BLACK);
    mockScheme = 'dark';
    expect(render(true, true, false).element.props.children.props.buttonStyle).toBe(Apple.AppleAuthenticationButtonStyle.WHITE);
});
