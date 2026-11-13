import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { allowsVisionNavigation } from '../../lib/liveEdit/navigation';
import { createVisionJob, type Frame, type Inference } from '../../lib/liveEdit/protocol';
type Props = { frame: Frame; onResult(value: Inference): void; onError(): void };
// Key this component by source/frame. A timeout or cancel destroys the entire WASM heap.
export function VisionBridge({ frame, onResult, onError }: Props) {
    const ref = useRef<WebView<object>>(null), callbacks = useRef({ onResult, onError });
    callbacks.current = { onResult, onError };
    const [uri, setUri] = useState<string | null>(null), [closed, setClosed] = useState(false);
    const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const job = useRef<ReturnType<typeof createVisionJob> | null>(null);
    useEffect(() => {
        let mounted = true;
        const current = createVisionJob({
            send: message => {
                if (!ref.current) throw Error('inference-unavailable');
                ref.current.injectJavaScript(`window.liveEditReceive(${JSON.stringify(message)});true;`);
            },
            close: () => { if (loadTimer.current) clearTimeout(loadTimer.current); if (mounted) setClosed(true); },
        });
        job.current = current;
        const timer = loadTimer.current = setTimeout(() => { current.close(); if (mounted) callbacks.current.onError(); }, 60_000);
        // Static Metro asset: bundled into the release, no user URI or remote document.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Asset.loadAsync(require('../../../assets/live-edit/runtime.html')).then(([asset]) => {
            if (mounted && asset.localUri?.startsWith('file://')) setUri(asset.localUri);
            else if (mounted) throw Error('inference-unavailable');
        }).catch(() => { current.close(); if (mounted) callbacks.current.onError(); });
        return () => { mounted = false; finished.current = true; clearTimeout(timer); current.close(); job.current = null; };
    }, []);
    const started = useRef(false), finished = useRef(false);
    async function start() {
        if (started.current || !job.current) return;
        if (loadTimer.current) clearTimeout(loadTimer.current);
        started.current = true; const current = job.current;
        try {
            await current.init(); const result = await current.detect(frame);
            if (job.current === current && !finished.current) { finished.current = true; callbacks.current.onResult(result); }
            current.close();
        } catch { if (job.current === current) fail(); }
    }
    function fail() {
        if (finished.current) return;
        finished.current = true; job.current?.close(); callbacks.current.onError();
    }
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.hidden}>
        {uri && !closed ? <WebView<object> ref={ref} source={{ uri }} onLoadEnd={() => void start()}
            onMessage={event => job.current?.receive(event.nativeEvent.data)}
            onError={fail}
            onContentProcessDidTerminate={fail}
            onRenderProcessGone={fail}
            originWhitelist={['file://*', 'about:blank']} onShouldStartLoadWithRequest={request => allowsVisionNavigation(request.url, uri)}
            allowingReadAccessToURL={uri} allowFileAccess allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
            javaScriptEnabled domStorageEnabled={false} cacheEnabled={false} incognito
            mixedContentMode="never" setSupportMultipleWindows={false} mediaPlaybackRequiresUserAction
        /> : null}
    </View>;
}
const styles = StyleSheet.create({ hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' } });
