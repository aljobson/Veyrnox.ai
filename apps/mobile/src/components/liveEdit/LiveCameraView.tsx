import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { t } from '../../lib/i18n';
import type { Stack } from '../../lib/liveEdit/engine';
import { liveMessage, parseLiveEvent, type LiveError, type LiveFace, type LiveWig } from '../../lib/liveEdit/liveProtocol';
import { allowsVisionNavigation } from '../../lib/liveEdit/navigation';

export type LiveCameraHandle = { capture(): void; switchCamera(): void };
type Props = {
    stack: Stack; compare: boolean; height: number;
    onStarted(cameras: number): void; onFace(status: LiveFace): void; onWig(status: LiveWig): void;
    onError(code: LiveError): void; onPhoto(uri: string): void;
};
const START_TIMEOUT_MS = 90_000; // the models are ~40 MB of base64 to decode and initialise on a phone
const CAPTURE_TIMEOUT_MS = 15_000;
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

/**
 * Live camera (ADR-0335 S8). The camera, the face tracker and the web live engine run inside one offline WebView document
 * (assets/live-edit/runtime.html): no network, no new native module. Mounting this view is what opens the camera and
 * unmounting it destroys the WebView, which releases the camera. It is only mounted after the OS camera permission is granted.
 */
export const LiveCameraView = forwardRef<LiveCameraHandle, Props>(function LiveCameraView({ stack, compare, height, onStarted, onFace, onWig, onError, onPhoto }, handle) {
    const web = useRef<WebView<object>>(null), callbacks = useRef({ onStarted, onFace, onWig, onError, onPhoto });
    callbacks.current = { onStarted, onFace, onWig, onError, onPhoto };
    const [uri, setUri] = useState<string | null>(null), [permitted, setPermitted] = useState(false);
    const started = useRef(false), loaded = useRef(false), mounted = useRef(true), capture = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null), sequence = useRef(0);
    const latest = useRef({ stack, compare }); latest.current = { stack, compare };
    const send = (message: string) => web.current?.injectJavaScript(`window.liveEditReceive(${JSON.stringify(message)});true;`);
    const fail = (code: LiveError) => { if (!mounted.current) return; started.current = false; callbacks.current.onError(code); };

    useEffect(() => {
        mounted.current = true;
        // Only a granted OS permission lets the WebView exist at all. A denied one never reaches getUserMedia.
        void ImagePicker.requestCameraPermissionsAsync().then(result => { if (mounted.current) { if (result.granted) setPermitted(true); else fail('camera-denied'); } }, () => fail('camera-failed'));
        // Static Metro asset, bundled into the release: no user URI or remote document.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Asset.loadAsync(require('../../../assets/live-edit/runtime.html')).then(([asset]) => {
            if (!mounted.current) return;
            // `#live` is what lets the page open the camera: no other document of this app is loaded with it.
            if (asset.localUri?.startsWith('file://')) setUri(asset.localUri); else fail('live-unavailable');
        }).catch(() => fail('live-unavailable'));
        const timer = setTimeout(() => { if (!started.current) fail('camera-failed'); }, START_TIMEOUT_MS);
        return () => { mounted.current = false; clearTimeout(timer); if (capture.current) clearTimeout(capture.current.timer); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { if (started.current) send(liveMessage('live.settings', { settings: stack })); }, [stack]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (started.current) send(liveMessage('live.compare', { value: compare })); }, [compare]); // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(handle, () => ({
        capture() {
            if (!started.current || capture.current) return;
            const id = ++sequence.current;
            capture.current = { id, timer: setTimeout(() => { capture.current = null; fail('camera-not-ready'); }, CAPTURE_TIMEOUT_MS) };
            send(liveMessage('live.capture', { id }));
        },
        switchCamera() { if (started.current) send(liveMessage('live.switch')); },
    }));

    function receive(raw: string) {
        const event = parseLiveEvent(raw);
        if (!event || !mounted.current) return;
        switch (event.live) {
        case 'started':
            started.current = true; callbacks.current.onStarted(event.cameras);
            send(liveMessage('live.settings', { settings: latest.current.stack })); send(liveMessage('live.compare', { value: latest.current.compare }));
            break;
        case 'face': callbacks.current.onFace(event.status); break;
        case 'wig': callbacks.current.onWig(event.status); break;
        case 'error': fail(event.code); break;
        case 'photo': {
            const pending = capture.current;
            if (!pending || pending.id !== event.id) return;
            clearTimeout(pending.timer); capture.current = null;
            // The cache copy is deleted here if it cannot be completed; once onPhoto has it, the screen owns and deletes it.
            let file: File | null = null;
            try {
                file = new File(Paths.cache, `live-camera-${Date.now()}.jpg`);
                file.create({ overwrite: true }); file.write(decode(event.base64));
                const done = file.uri; file = null; callbacks.current.onPhoto(done);
            } catch { try { if (file?.exists) file.delete(); } catch { /* already gone */ } fail('export-failed'); }
            break;
        }
        default: break;
        }
    }
    return <View accessibilityLabel={t('liveEdit.camera.preview')} accessibilityRole="image" style={[styles.frame, { height }]}>
        {uri && permitted ? <WebView<object> ref={web} source={{ uri: `${uri}#live` }}
            onLoadEnd={() => { if (!loaded.current) { loaded.current = true; send(liveMessage('live.start')); } }}
            onMessage={event => receive(event.nativeEvent.data)}
            onError={() => fail('camera-failed')} onContentProcessDidTerminate={() => fail('camera-failed')} onRenderProcessGone={() => fail('camera-failed')}
            // '*' hands every URL to the strict callback below; with a narrower list react-native-webview opens the rest in the OS browser itself.
            originWhitelist={['*']} onShouldStartLoadWithRequest={request => allowsVisionNavigation(request.url, uri, '#live')}
            allowingReadAccessToURL={uri} allowFileAccess allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
            javaScriptEnabled domStorageEnabled={false} cacheEnabled={false} incognito mixedContentMode="never" setSupportMultipleWindows={false}
            // The one thing this WebView may do that the hidden one may not: play the camera inline and capture media.
            allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="grant" androidLayerType="hardware"
            scrollEnabled={false} bounces={false} style={styles.web}
        /> : null}
    </View>;
});
const styles = StyleSheet.create({ frame: { width: '100%', backgroundColor: '#000', overflow: 'hidden', borderRadius: 12 }, web: { flex: 1, backgroundColor: '#000' } });
