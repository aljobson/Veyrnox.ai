import { act } from 'react';
import { AccessibilityInfo, Text as NativeText } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ExpoRoot, Slot } from 'expo-router';
import { Try } from 'expo-router/build/views/Try';
import { ErrorFallback, SignedInErrorBoundary } from '../src/components/ErrorFallback';
import { captureIssue } from '../src/lib/crash';

jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
    const React = require('react'), { View } = require('react-native');
    return { ...jest.requireActual('react-native-safe-area-context'),
        SafeAreaProvider: ({ children }: any) => children,
        SafeAreaView: ({ children, ...props }: any) => React.createElement(View, props, children),
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    };
});
let root: Root, broken = true;
function Child() { if (broken) throw new Error('private crash details'); return <NativeText>Recovered child</NativeText>; }
const visible = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
async function press(label: string) {
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
    expect(button).toBeDefined();
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    broken = true; jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('real Try catches a render error without providers, reports once, and retries successfully', async () => {
    await act(async () => root.render(<Try catch={ErrorFallback}><Child /></Try>));
    expect(visible('Something went wrong')).toBe(true);
    expect(visible('private crash details')).toBe(false);
    expect(captureIssue).toHaveBeenCalledTimes(1);
    expect(captureIssue).toHaveBeenCalledWith('render_error', { boundary: 'root', error: 'Error' });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Something went wrong');
    broken = false; await press('Try again');
    expect(visible('Recovered child')).toBe(true);
    expect(captureIssue).toHaveBeenCalledTimes(1);
});
test('fallback invokes retry and does not report again on rerender', async () => {
    const error = new Error('secret'), retry = jest.fn(async () => {});
    await act(async () => root.render(<ErrorFallback error={error} retry={retry} />));
    await act(async () => root.render(<ErrorFallback error={error} retry={retry} />));
    await press('Try again');
    expect(retry).toHaveBeenCalledTimes(1); expect(captureIssue).toHaveBeenCalledTimes(1);
});
test('Go home clears the real router boundary and remounts the navigator at home', async () => {
    const routes: Record<string, object> = {
        './_layout.tsx': { default: Slot },
        './(app)/_layout.tsx': { default: Slot, ErrorBoundary: SignedInErrorBoundary },
        './(app)/(tabs)/_layout.tsx': { default: Slot },
        './(app)/(tabs)/index.tsx': { default: () => <NativeText>Home screen content</NativeText> },
        './(app)/broken.tsx': { default: Child },
    };
    const context = Object.assign((key: string) => routes[key], { keys: () => Object.keys(routes), resolve: (key: string) => key, id: 'boundary-test' });
    await act(async () => root.render(<ExpoRoot context={context as any} location="/broken" />));
    expect(visible('Something went wrong')).toBe(true);
    await press('Go home');
    expect(visible('Home screen content')).toBe(true);
    expect(visible('Something went wrong')).toBe(false);
    expect(broken).toBe(true); // Navigation recovered without fixing or mocking the broken route.
});
