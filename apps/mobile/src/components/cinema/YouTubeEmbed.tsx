import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { WEB_ORIGIN } from '../../lib/cinemaBrowse';
import { getLocale, t } from '../../lib/i18n';
import { allowEmbedNavigation, embedHtml, embedPlayerConfig, parseEmbedMessage, PAUSE_SCRIPT, PLAYER_READY_TIMEOUT_MS, playerSize, type EmbedErrorCause } from '../../lib/youtubeEmbed';

export type YouTubeEmbedHandle = { pause(): void };
type Props = {
    videoId: string; durationSeconds: number; title: string;
    onReady(): void; onBlocked(): void; onError(cause: EmbedErrorCause): void;
};
export const YouTubeEmbed = forwardRef<YouTubeEmbedHandle, Props>(function YouTubeEmbed({ videoId, durationSeconds, title, onReady, onBlocked, onError }, ref) {
    const webview = useRef<WebView<unknown>>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    const { width } = useWindowDimensions();
    const locale = getLocale();
    const frameTitle = t('cinemaEmbed.frame', { title });
    const config = useMemo(() => embedPlayerConfig(videoId, durationSeconds, locale, frameTitle), [videoId, durationSeconds, locale, frameTitle]);
    const source = useMemo(() => config ? { html: embedHtml(config), baseUrl: `${WEB_ORIGIN}/` } : null, [config]);
    const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
    useImperativeHandle(ref, () => ({ pause: () => webview.current?.injectJavaScript(PAUSE_SCRIPT) }), []);
    useEffect(() => {
        if (!source) { callbacks.current.onError(null); return; }
        timer.current = setTimeout(() => { timer.current = null; callbacks.current.onError('timeout'); }, PLAYER_READY_TIMEOUT_MS);
        return clearTimer;
    }, [source]);
    if (!source) return null;
    return (
        <View testID="youtube-player-container" style={[styles.blank, playerSize(width)]}>
            <WebView ref={webview} style={styles.player} source={source} originWhitelist={['*']}
                onShouldStartLoadWithRequest={req => allowEmbedNavigation(req, videoId) || (onBlocked(), false)}
                onOpenWindow={() => onBlocked()} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
                allowsLinkPreview={false} dataDetectorTypes="none" allowsInlineMediaPlayback allowsFullscreenVideo
                mediaPlaybackRequiresUserAction allowFileAccess={false} incognito accessibilityLabel={frameTitle}
                onMessage={e => {
                    const message = parseEmbedMessage(e.nativeEvent.data, e.nativeEvent.url);
                    if (!message) return;
                    clearTimer();
                    if (message.type === 'ready') onReady(); else onError(message.code);
                }}
                onError={e => { e.preventDefault(); clearTimer(); onError('load'); }}
                renderError={() => <View testID="embed-error-blank" style={styles.blank} />} />
        </View>
    );
});
const styles = StyleSheet.create({ blank: { backgroundColor: '#000' }, player: { flex: 1, backgroundColor: '#000' } });
