import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { config } from '../lib/config';
import {
    allowTurnstileNavigation,
    turnstileOrigins,
    parseTurnstileMessage,
    TURNSTILE_SITE_KEY,
    turnstileHtml,
    type TurnstileMessage,
} from '../lib/auth/turnstile';

interface Props {
    // Change this value to start a fresh check; a Turnstile token works once.
    readonly resetKey: number;
    readonly onMessage: (message: TurnstileMessage) => void;
}

export function TurnstileView({ resetKey, onMessage }: Props) {
    const html = useMemo(() => turnstileHtml(TURNSTILE_SITE_KEY), []);
    // Invisible unless Cloudflare asks for an interaction; it never takes space otherwise.
    const [interactive, setInteractive] = useState(false);
    return (
        <View style={[styles.box, !interactive && styles.hidden]}>
            <WebView
                key={resetKey}
                onLoadStart={() => setInteractive(false)}
                originWhitelist={turnstileOrigins(config.apiBase, __DEV__)}
                source={{ html, baseUrl: config.apiBase }}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled={false}
                style={styles.web}
                // Only our own page talks to the app, and only through postMessage.
                onMessage={(e) => {
                    const message = parseTurnstileMessage(e.nativeEvent.data);
                    if (!message) return;
                    if (message.type === 'interactive') setInteractive(message.on);
                    onMessage(message);
                }}
                onError={() => onMessage({ type: 'error', code: 'load_failed' })}
                onHttpError={() => onMessage({ type: 'error', code: 'load_failed' })}
                // Only the top-level page is held to the allowlist. Cloudflare's own challenge frame loads
                // internal URLs (about:srcdoc, blob:) that this check would otherwise block, which
                // surfaced as Turnstile error 300031 on the phone.
                onShouldStartLoadWithRequest={(req) =>
                    req.isTopFrame === false || allowTurnstileNavigation(req.url, config.apiBase, __DEV__)
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { height: 80, borderRadius: 12, overflow: 'hidden' },
    hidden: { height: 1, opacity: 0 },
    web: { backgroundColor: 'transparent' },
});
