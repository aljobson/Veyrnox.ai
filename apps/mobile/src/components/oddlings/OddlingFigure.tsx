import { useEffect, useMemo, useRef, type ComponentProps, type ComponentType, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { t } from '../../lib/i18n';
import { FIGURE_BACKGROUND, figureCall, figureHtml } from '../../lib/oddlingsFigure';
import type { Picks } from '../../lib/oddlingsBuilder';

// The package's class typing rejects a ref under React 19's types; the one method used is declared here.
interface Injectable { injectJavaScript(script: string): void }
const Web = WebView as unknown as ComponentType<ComponentProps<typeof WebView> & { ref?: Ref<Injectable> }>;

interface Props {
    picks: Picks;
    focus?: string;
    height?: number;
}

// A stylised stand-in drawn offline on the phone; the real picture is made from the same picks. It is decoration for
// the touch screen (the choices are the controls), so it takes no touches.
export function OddlingFigure({ picks, focus = 'body', height = 280 }: Props) {
    const ref = useRef<Injectable | null>(null);
    const loaded = useRef(false);
    const html = useMemo(() => figureHtml(), []);
    const call = useMemo(() => figureCall(picks, focus), [picks, focus]);

    useEffect(() => {
        if (loaded.current) ref.current?.injectJavaScript(call);
    }, [call]);

    return (
        <View style={[styles.box, { height }]} accessible accessibilityRole="image" accessibilityLabel={t('oddlings.figure.label')} importantForAccessibility="yes" pointerEvents="none">
            <Web
                ref={ref}
                source={{ html }}
                originWhitelist={['about:*']}
                onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
                javaScriptEnabled
                scrollEnabled={false}
                bounces={false}
                overScrollMode="never"
                setSupportMultipleWindows={false}
                allowsLinkPreview={false}
                style={styles.web}
                onLoadEnd={() => {
                    loaded.current = true;
                    ref.current?.injectJavaScript(call);
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { borderRadius: 16, overflow: 'hidden', backgroundColor: FIGURE_BACKGROUND },
    web: { flex: 1, backgroundColor: FIGURE_BACKGROUND },
});
