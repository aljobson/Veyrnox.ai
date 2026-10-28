import { act } from 'react';
import { AccessibilityInfo, AppState, Linking, Platform, StyleSheet, type AppStateStatus } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { createRoot, type Root } from 'test-renderer';
import EditorialPlayer from '../src/app/editorial/[id]';
import { YouTubeEmbed } from '../src/components/cinema/YouTubeEmbed';
import { EDITORIAL_SERIES } from '../src/lib/cinemaEditorialData';
import { mapAppLink } from '../src/lib/appLinks';
import { t } from '../src/lib/i18n';
import { PAUSE_SCRIPT, PLAYER_READY_TIMEOUT_MS } from '../src/lib/youtubeEmbed';

declare const __dirname: string;
jest.setTimeout(30000);
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };
const mockRequest = jest.fn(), mockInject = jest.fn();
let mockParams: Record<string, string>, mockStatus: string, mockProps: any, mockMounts: number, mockFocused: boolean, mockWidth: number;
jest.mock('expo-router', () => ({
    useLocalSearchParams: () => mockParams, useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => {
        jest.requireActual('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]);
    },
}));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: mockStatus, api: { request: mockRequest } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('react-native', () => {
    const rn = jest.requireActual('react-native');
    return Object.defineProperty(Object.create(rn), 'useWindowDimensions', { value: () => ({ width: mockWidth, height: 568, scale: 1, fontScale: 1 }) });
});
jest.mock('react-native-webview', () => {
    const React = jest.requireActual('react');
    return { WebView: React.forwardRef((props: any, ref: any) => {
        mockProps = props;
        React.useEffect(() => { mockMounts++; }, []);
        React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
        return null;
    }) };
});
const native = jest.requireActual('react-native');
void [native.Pressable, native.ScrollView, native.Text, native.View];
const series = EDITORIAL_SERIES[0], episode = series.episodes[0];
let root: Root, appState: (state: AppStateStatus) => void;
const visible = (text: string) => root.container.queryAll(node => node.children.includes(text)).length > 0;
const buttons = (label: string) => root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label);
const live = (text: string) => root.container.queryAll(node => node.props.accessibilityLiveRegion === 'polite' && node.children.includes(text));
const render = async () => { await act(async () => root.render(<EditorialPlayer />)); };
const advance = async () => { await act(async () => { await jest.advanceTimersByTimeAsync(PLAYER_READY_TIMEOUT_MS); }); };
async function press(label: string) {
    expect(buttons(label)).toHaveLength(1);
    await act(async () => buttons(label)[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
async function message(data: object, url = 'https://veyrnox.ai/', handler = mockProps.onMessage) {
    await act(async () => handler({ nativeEvent: { data: JSON.stringify(data), url } }));
}
function announcement(text: string) {
    if (Platform.OS === 'ios') {
        expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(text);
    } else {
        expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
        expect(live(text)).toHaveLength(1);
    }
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); jest.useFakeTimers();
    mockParams = { id: episode.id, series: series.slug }; mockStatus = 'signedIn'; mockFocused = true;
    mockProps = undefined; mockMounts = 0; mockWidth = 402; mockRouter.canGoBack.mockReturnValue(false);
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => { appState = fn; return { remove: jest.fn() }; });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('WebView pins privacy, playback, navigation, health and sizing props', async () => {
    await render();
    expect(mockProps).toMatchObject({ originWhitelist: ['*'], setSupportMultipleWindows: false, javaScriptCanOpenWindowsAutomatically: false,
        allowsLinkPreview: false, dataDetectorTypes: 'none', mediaPlaybackRequiresUserAction: true, allowsInlineMediaPlayback: true,
        allowsFullscreenVideo: true, allowFileAccess: false, incognito: true, source: { baseUrl: 'https://veyrnox.ai/' },
        accessibilityLabel: t('cinemaEmbed.frame', { title: episode.title }) });
    expect(mockProps.source.html).toContain(episode.videoId); expect(mockProps.source.html).not.toContain('<iframe');
    for (const name of ['onOpenWindow', 'onMessage', 'renderError']) expect(typeof mockProps[name]).toBe('function');
    expect(mockProps.onHttpError).toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(visible(t('cinemaEmbed.rights', { creator: series.creatorName }))).toBe(true);
});
test.each(['ios', 'android'] as const)('blocked links stay in app and announce once on %s', async platform => {
    jest.replaceProperty(Platform, 'OS', platform); await render();
    for (const url of ['https://www.youtube.com/watch?v='+episode.videoId, 'vnd.youtube:'+episode.videoId]) {
        await act(async () => { expect(mockProps.onShouldStartLoadWithRequest({ url })).toBe(false); });
    }
    await act(async () => mockProps.onOpenWindow({ nativeEvent: { targetUrl: 'https://youtube.com' } }));
    expect(visible(t('cinemaEmbed.linkBlocked'))).toBe(true); announcement(t('cinemaEmbed.linkBlocked'));
    expect(buttons(t('cinemaEmbed.retry'))).toHaveLength(0);
    expect(Linking.openURL).not.toHaveBeenCalled(); expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
});
test('next replaces with the next episode and the last episode has no next button', async () => {
    await render(); await press(t('cinema.player.next', { title: series.episodes[1].title }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/editorial/[id]', params: { id: series.episodes[1].id, series: series.slug } });
    mockParams.id = series.episodes.at(-1)!.id; await render();
    expect(root.container.queryAll(n => String(n.props.accessibilityLabel).startsWith('Next episode'))).toHaveLength(0);
});
test('blur and background pause the controlled player', async () => {
    await render(); await act(async () => appState('background')); expect(mockInject).toHaveBeenLastCalledWith(PAUSE_SCRIPT);
    mockInject.mockClear(); mockFocused = false; await render(); expect(mockInject).toHaveBeenCalledWith(PAUSE_SCRIPT);
});
test.each([
    { series: 'unknown', id: episode.id }, { series: series.slug, id: EDITORIAL_SERIES[1].episodes[0].id }, { series: series.slug, id: '../bad' },
])('unknown pair %j stays quiet without API calls', async params => {
    mockParams = params; await render(); expect(visible(t('cinemaSeries.unavailable'))).toBe(true);
    expect(mockProps).toBeUndefined(); expect(mockRequest).not.toHaveBeenCalled(); expect(buttons('Close')).toHaveLength(1);
});
test.each(['signedIn', 'signedOut', 'loading'])('public player renders for %s; close falls back correctly', async status => {
    mockStatus = status; await render(); expect(mockProps).toBeDefined(); expect(mockRequest).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.type === 'Redirect')).toHaveLength(0);
    expect(buttons(t('cinemaSeries.allEpisodes'))).toHaveLength(status === 'signedIn' ? 1 : 0);
    await press('Close'); expect(mockRouter.replace).toHaveBeenCalledWith(status === 'signedIn' ? { pathname: '/cinema/series/[slug]', params: { slug: series.slug } } : '/preview');
});
test('close uses back when history exists', async () => {
    mockRouter.canGoBack.mockReturnValue(true); await render(); await press('Close');
    expect(mockRouter.back).toHaveBeenCalledTimes(1); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test.each([true, false])('All episodes always replaces its own series, canGoBack=%s', async canGoBack => {
    const link = `ai.veyrnox.app://editorial/${episode.id}?series=${series.slug}`;
    expect(mapAppLink(link)).toBe(link); mockRouter.canGoBack.mockReturnValue(canGoBack); await render();
    await press(t('cinemaSeries.allEpisodes'));
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/cinema/series/[slug]', params: { slug: series.slug } });
    expect(mockRouter.back).not.toHaveBeenCalled();
});
test('route lives outside app auth and MFA gates', () => {
    const fs = require('fs'), path = require('path'); const base = path.join(__dirname, '../src/app');
    expect(fs.existsSync(path.join(base, 'editorial/[id].tsx'))).toBe(true);
    for (const name of ['(app)/editorial', '(app)/cinema/editorial']) expect(fs.existsSync(path.join(base, name))).toBe(false);
    expect(fs.readFileSync(path.join(base, 'editorial/[id].tsx'), 'utf8')).not.toMatch(/Redirect|MfaGate/);
});
test.each(['ios', 'android'] as const)('player errors and retry announce on %s', async platform => {
    jest.replaceProperty(Platform, 'OS', platform); await render();
    await message({ type: 'error', code: 150 }, 'https://www.youtube-nocookie.com');
    expect(visible(t('cinemaEmbed.error.notEmbeddable'))).toBe(false);
    await message({ type: 'error', code: 150 });
    expect(visible(t('cinemaEmbed.error.notEmbeddable'))).toBe(true); announcement(t('cinemaEmbed.error.notEmbeddable'));
    await act(async () => mockProps.onOpenWindow()); // A block never replaces a player error.
    expect(visible(t('cinemaEmbed.linkBlocked'))).toBe(false);
    await message({ type: 'error', code: 100 }); expect(visible(t('cinemaEmbed.error.unavailable'))).toBe(true);
    await message({ type: 'error', code: 153 }); expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    await press(t('cinemaEmbed.retry')); expect(mockMounts).toBe(2); expect(visible(t('cinemaEmbed.error.playback'))).toBe(false);
    await advance(); expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    if (platform === 'ios') expect(jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([text]) => text === t('cinemaEmbed.error.playback'))).toHaveLength(2);
    else { expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled(); expect(live(t('cinemaEmbed.error.playback'))).toHaveLength(1); }
});
test('ready and player errors cancel the ready timeout', async () => {
    await render(); await message({ type: 'ready' }); await advance(); expect(visible(t('cinemaEmbed.error.playback'))).toBe(false);
    mockParams.id = series.episodes[1].id; await render();
    await message({ type: 'error', code: 150 }); await advance(); expect(visible(t('cinemaEmbed.error.notEmbeddable'))).toBe(true);
});
test('loader never ready leaves no static iframe and times out with retry', async () => {
    await render(); expect(mockProps.source.html).not.toContain('<iframe'); await advance();
    expect(visible(t('cinemaEmbed.error.playback'))).toBe(true); expect(buttons(t('cinemaEmbed.retry'))).toHaveLength(1);
});
test('load failure prevents default English error page and provides blank fallback', async () => {
    await render(); const preventDefault = jest.fn();
    await act(async () => mockProps.onError({ nativeEvent: { description: 'x' }, preventDefault, persist: jest.fn() }));
    expect(preventDefault).toHaveBeenCalledTimes(1); expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    await message({ type: 'ready' }); expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    const fallback = mockProps.renderError(); await act(async () => root.render(fallback));
    expect(root.container.queryAll(n => n.children.some(child => typeof child === 'string'))).toHaveLength(0);
});
test.each([[320, 200], [402, 226]])('full bleed width %s uses minimum player height %s', async (width, height) => {
    mockWidth = width; await render();
    const container = root.container.queryAll(n => n.props.testID === 'youtube-player-container')[0];
    expect(StyleSheet.flatten(container.props.style)).toMatchObject({ width, height });
});
test.each(['ios', 'android'] as const)('late ready clears only current timeout on %s', async platform => {
    jest.replaceProperty(Platform, 'OS', platform); await render();
    const firstMessage = mockProps.onMessage; await advance();
    expect(visible(t('cinemaEmbed.error.playback'))).toBe(true); expect(buttons(t('cinemaEmbed.retry'))).toHaveLength(1);
    await message({ type: 'ready' }); expect(visible(t('cinemaEmbed.error.playback'))).toBe(false);
    expect(buttons(t('cinemaEmbed.retry'))).toHaveLength(0); expect(live(t('cinemaEmbed.error.playback'))).toHaveLength(0);
    await message({ type: 'error', code: 150 }); await message({ type: 'ready' });
    expect(visible(t('cinemaEmbed.error.notEmbeddable'))).toBe(true);
    await press(t('cinemaEmbed.retry')); await act(async () => mockProps.onOpenWindow()); await message({ type: 'ready' });
    expect(visible(t('cinemaEmbed.linkBlocked'))).toBe(true);
    await message({ type: 'error', code: null }); expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    await message({ type: 'ready' }); expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    await press(t('cinemaEmbed.retry')); await advance();
    await message({ type: 'ready' }, 'https://veyrnox.ai/', firstMessage);
    expect(visible(t('cinemaEmbed.error.playback'))).toBe(true);
    await message({ type: 'ready' }); expect(visible(t('cinemaEmbed.error.playback'))).toBe(false);
    await message({ type: 'error', code: 150 }, 'https://veyrnox.ai/', firstMessage);
    expect(visible(t('cinemaEmbed.error.notEmbeddable'))).toBe(false);
});
test('invalid video renders nothing and reports error once', async () => {
    const onError = jest.fn();
    const element = <YouTubeEmbed videoId="bad" durationSeconds={504} title="T" onReady={jest.fn()} onBlocked={jest.fn()} onError={onError} />;
    await act(async () => root.render(element)); await act(async () => root.render(element));
    expect(mockProps).toBeUndefined(); expect(onError).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith(null);
});

test('unmount cancels player readiness timeout', async () => {
    const onError = jest.fn();
    await act(async () => root.render(<YouTubeEmbed videoId={episode.videoId} durationSeconds={504} title="T"
        onReady={jest.fn()} onBlocked={jest.fn()} onError={onError} />));
    await act(async () => root.render(<></>)); await advance();
    expect(onError).not.toHaveBeenCalled();
});
