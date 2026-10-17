import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { config } from '../lib/config';
import {
    allowTurnstileNavigation,
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
    return (
        <View style={styles.box}>
            <WebView
                key={resetKey}
                originWhitelist={['https://*', 'about:*']}
                source={{ html, baseUrl: config.apiBase }}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled={false}
                style={styles.web}
                // Only our own page talks to the app, and only through postMessage.
                onMessage={(e) => {
                    const message = parseTurnstileMessage(e.nativeEvent.data);
                    if (message) onMessage(message);
                }}
                onShouldStartLoadWithRequest={(req) => allowTurnstileNavigation(req.url)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { height: 80, borderRadius: 12, overflow: 'hidden' },
    web: { backgroundColor: 'transparent' },
});
