import { useCallback, useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { WOBNIMO_SCRIPT } from '../lib/wobnimoBundle.generated';
import type { WobnimoId, WobnimoState } from '../lib/veyCharacterChoice';

// A wobnimo mascot drawn by the engine inside a WebView. The page is built here and the CSP below allows nothing but
// its own inline engine and styles: no network, frames, forms or outside resources. Navigation is refused outright.
// The art is decorative; the button around it carries semantics.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; "
    + "connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function page(character: WobnimoId, state: WobnimoState): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">`
        + `<meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}`
        + `wobnimo-mascot{display:block;width:100%;height:100%}</style></head><body>`
        + `<wobnimo-mascot id="m" character="${character}" state="${state}"></wobnimo-mascot>`
        + `<script>var post=function(s){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(s)};`
        + `window.addEventListener('error',function(){post('failed')});`
        + `try{${WOBNIMO_SCRIPT};window.__wobnimo.defineWobnimoElement();post('ready')}catch(e){post('failed')}</script>`
        + `</body></html>`;
}

const setState = (state: WobnimoState) =>
    `var m=document.getElementById('m');m&&m.setAttribute('state',${JSON.stringify(state)});true;`;

// `onFailure` fires when the engine cannot start (for example no WebGL), so the caller can show the robot instead.
export function WobnimoView({ character, state, width, onFailure }: {
    character: WobnimoId; state: WobnimoState; width: number; onFailure?: () => void;
}) {
    const ref = useRef<ComponentRef<typeof WebView>>(null);
    const latest = useRef(state);
    // Only the page's own first load may happen; once it reports in, every further navigation is refused.
    const loading = useRef(true);
    latest.current = state;
    // Each page starts in the state wanted when it was built; later changes go into the running page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const html = useMemo(() => { loading.current = true; return page(character, latest.current); }, [character]);
    useEffect(() => { ref.current?.injectJavaScript(setState(state)); }, [state]);
    const onMessage = useCallback((event: WebViewMessageEvent) => {
        // The page may have been told something new while it loaded: replay the latest state once it is ready.
        loading.current = false;
        if (event.nativeEvent.data === 'ready') ref.current?.injectJavaScript(setState(latest.current));
        else if (event.nativeEvent.data === 'failed') onFailure?.();
    }, [onFailure]);
    return (
        <View style={[styles.box, { width, height: width }]} pointerEvents="none"
            accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <WebView
                ref={ref}
                source={{ html }}
                // '*' only so the library never hands a URL to the system browser; the callback below refuses them all.
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={(request) => loading.current && (request.url === 'about:blank' || request.url.startsWith('data:'))}
                onMessage={onMessage}
                onError={() => onFailure?.()}
                javaScriptEnabled
                scrollEnabled={false}
                bounces={false}
                overScrollMode="never"
                setSupportMultipleWindows={false}
                allowsLinkPreview={false}
                style={styles.web}
                containerStyle={styles.web}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { overflow: 'hidden' },
    web: { flex: 1, backgroundColor: 'transparent' },
});
