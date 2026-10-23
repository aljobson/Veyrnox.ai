import { act } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';

void [ActivityIndicator, Pressable, StyleSheet, Text, View];

const projectId = '11111111-1111-1111-1111-111111111111';
const mockRouter = { push: jest.fn() };
const mockGetAccessToken = jest.fn();
let webProps: any;

const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const accessToken = `x.${encode({ sub: 'user-1', exp: 3600 })}.y`;

jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    useRouter: () => mockRouter,
}));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ getAccessToken: mockGetAccessToken }) }));
jest.mock('react-native-webview', () => {
    const React = jest.requireActual('react');
    function MockWebView(props: any, _ref: any) { webProps = props; return null; }
    return { WebView: React.forwardRef(MockWebView) };
});

let root: Root;
const visible = (text: string) => root.container.queryAll((node) => node.children.includes(text)).length > 0;

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.clearAllMocks();
    webProps = undefined;
    mockGetAccessToken.mockResolvedValue(accessToken);
    root = createRoot();
});

afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
});

async function render() {
    await act(async () => root.render(<FullEditorScreen projectId={projectId} />));
    await act(async () => jest.advanceTimersByTimeAsync(0));
}

test('loads the selected project with a fresh native session and locked-down WebView', async () => {
    await render();
    expect(mockGetAccessToken).toHaveBeenCalledWith(true);
    expect(webProps.source.uri).toBe(`https://veyrnox.ai/app/editor?project=${projectId}`);
    expect(webProps.injectedJavaScriptBeforeContentLoaded).toContain('veyrnox_supabase_session');
    expect(webProps.source.uri).not.toContain('token');
    expect(webProps).toMatchObject({
        incognito: true,
        domStorageEnabled: true,
        allowFileAccess: false,
        setSupportMultipleWindows: false,
        javaScriptCanOpenWindowsAutomatically: false,
    });
    expect(webProps.onShouldStartLoadWithRequest({ url: 'https://veyrnox.ai/app/editor?project=1' })).toBe(true);
    expect(webProps.onShouldStartLoadWithRequest({ url: 'https://veyrnox.ai/app/credits' })).toBe(false);
    expect(webProps.onShouldStartLoadWithRequest({ url: 'https://evil.test' })).toBe(false);
});

test('removes loading on ready and routes web Credits to native Credits', async () => {
    await render();
    expect(visible('Opening the full editor…')).toBe(true);
    await act(async () => webProps.onMessage({ nativeEvent: { data: '{"type":"ready"}' } }));
    expect(visible('Opening the full editor…')).toBe(false);
    await act(async () => webProps.onMessage({ nativeEvent: { data: '{"type":"open-credits"}' } }));
    expect(mockRouter.push).toHaveBeenCalledWith('/credits');
});

test('refreshes once after a WebView process kill, then offers an explicit retry', async () => {
    await render();
    await act(async () => webProps.onContentProcessDidTerminate());
    expect(mockGetAccessToken).toHaveBeenCalledTimes(2);
    await act(async () => webProps.onRenderProcessGone());
    expect(visible('The full editor could not open')).toBe(true);
    expect(visible('The editor closed twice while the phone was freeing memory. Tap Retry to reopen it.')).toBe(true);
});

test('shows a retry instead of loading a page when no safe session is available', async () => {
    mockGetAccessToken.mockResolvedValue(null);
    await render();
    expect(webProps).toBeUndefined();
    expect(visible('Your session needs refreshing. Try again to reopen the editor.')).toBe(true);
});
