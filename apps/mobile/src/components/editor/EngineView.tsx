import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { nativeMessage, type NativeMessage } from '../../lib/editorBridge';

export interface EngineHandle { post(msg: NativeMessage): void }
interface Props {
    html: string;
    baseUrl: string;
    onMessage(event: WebViewMessageEvent): void;
    onKilled(): void;
    reloadKey: number;
}
export const EngineView = forwardRef<EngineHandle, Props>(function EngineView({ html, baseUrl, onMessage, onKilled, reloadKey }, ref) {
    const web = useRef<WebView<unknown>>(null);
    const baseOrigin = new URL(baseUrl).origin;
    const source = useMemo(() => ({ html, baseUrl }), [html, baseUrl]);
    useImperativeHandle(ref, () => ({ post: msg => web.current?.postMessage(nativeMessage(msg)) }), []);
    return <WebView key={reloadKey} ref={web} style={{ flex: 1 }} source={source}
        originWhitelist={[baseOrigin, 'about:*']}
        onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || url.startsWith(baseUrl)}
        incognito javaScriptEnabled domStorageEnabled={false} allowFileAccess={false}
        setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
        allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
        onMessage={onMessage} onContentProcessDidTerminate={onKilled} onRenderProcessGone={onKilled} />;
});
