import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import type { Wig } from '../../lib/liveEdit/engine';
import { overlaySize, parseWig3dReply, wig3dRequest } from '../../lib/liveEdit/liveProtocol';
import { allowsVisionNavigation } from '../../lib/liveEdit/navigation';
import { getOverlay, overlayKey, putOverlay } from '../../lib/liveEdit/wig';

export type Wig3dJob = { wig: Wig; landmarks: Float32Array; width: number; height: number };
type Props = { job: Wig3dJob; onChange(): void };
const REQUEST_TIMEOUT_MS = 30_000, START_TIMEOUT_MS = 45_000, DEBOUNCE_MS = 120;
const keyOf = (job: Wig3dJob) => overlayKey(job.wig, job.landmarks, job.width, job.height);

/**
 * Renders a 3D wig overlay for a still photo (ADR-0335 S9). three.js runs inside the same offline WebView document as the face models;
 * this component only sends landmarks and stores the returned PNG for planWig. One persistent hidden WebView, one request at a time,
 * the latest job wins. It exists only while a 3D wig is chosen; unmounting destroys the WebView and its GPU context.
 * This document is NOT the camera document: it is loaded without `#live`, capture is denied, and the page refuses live.* operations.
 * A crashed or stalled WebView is a terminal state: every job, current and later, ends as `unavailable` instead of loading forever.
 */
export function Wig3dBridge({ job, onChange }: Props) {
    const web = useRef<WebView<object>>(null), [uri, setUri] = useState<string | null>(null);
    const loaded = useRef(false), broken = useRef(false), mounted = useRef(true), sequence = useRef(0);
    const inflight = useRef<{ id: number; key: string; size: { width: number; height: number }; timer: ReturnType<typeof setTimeout> } | null>(null);
    const latest = useRef(job); latest.current = job;
    const wanted = useRef<string>(''), notify = useRef(onChange); notify.current = onChange;
    const key = keyOf(job);

    function finish(forKey: string, entry: Parameters<typeof putOverlay>[1]) {
        putOverlay(forKey, entry);
        if (mounted.current) notify.current();
    }
    /** Terminal failure: settle what is in flight and what is wanted now. Later jobs are settled by pump(). */
    function breakAll() {
        broken.current = true;
        const pending = inflight.current;
        if (pending) { clearTimeout(pending.timer); inflight.current = null; finish(pending.key, { status: 'unavailable' }); }
        const wantedKey = keyOf(latest.current);
        if (!getOverlay(wantedKey)) finish(wantedKey, { status: 'unavailable' });
    }
    function pump() {
        if (!mounted.current) return;
        if (broken.current) { const k = keyOf(latest.current); if (!getOverlay(k)) finish(k, { status: 'unavailable' }); return; }
        // One request at a time; when it ends, pump() asks for whatever the latest job needs next.
        if (!loaded.current || inflight.current) return;
        const current = latest.current, currentKey = keyOf(current);
        if (getOverlay(currentKey)) return; // already rendered (or already known to be unavailable) for exactly these inputs
        const id = ++sequence.current;
        const timer = setTimeout(() => { if (inflight.current?.id === id) { inflight.current = null; finish(currentKey, { status: 'unavailable' }); pump(); } }, REQUEST_TIMEOUT_MS);
        inflight.current = { id, key: currentKey, size: overlaySize(current.width, current.height), timer };
        try {
            web.current?.injectJavaScript(`window.liveEditReceive(${JSON.stringify(wig3dRequest({ id, style: current.wig.style, size: current.wig.size, offset: current.wig.offset, landmarks: current.landmarks, width: current.width, height: current.height }))});true;`);
        } catch { clearTimeout(timer); inflight.current = null; finish(currentKey, { status: 'unavailable' }); }
    }
    useEffect(() => {
        mounted.current = true;
        // Static Metro asset, bundled into the release: no user URI or remote document.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Asset.loadAsync(require('../../../assets/live-edit/runtime.html')).then(([asset]) => {
            if (!mounted.current) return;
            if (asset.localUri?.startsWith('file://')) setUri(asset.localUri); else breakAll();
        }).catch(() => breakAll());
        // A document that never finishes loading must not leave the screen waiting forever.
        const startup = setTimeout(() => { if (!loaded.current) breakAll(); }, START_TIMEOUT_MS);
        return () => { mounted.current = false; clearTimeout(startup); if (inflight.current) clearTimeout(inflight.current.timer); inflight.current = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Sliders move continuously: wait for the value to settle before asking for a new overlay.
    useEffect(() => {
        if (wanted.current === key) return;
        wanted.current = key;
        const timer = setTimeout(pump, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
    function receive(raw: string) {
        const pending = inflight.current;
        if (!pending) return;
        const reply = parseWig3dReply(raw, pending.id, pending.size);
        if (!reply) return;
        clearTimeout(pending.timer); inflight.current = null;
        // Whatever happens while storing the overlay, the request is settled and the next one is asked for.
        try { finish(pending.key, { status: reply.status, png: reply.png, fade: reply.fade }); }
        catch { try { finish(pending.key, { status: 'unavailable' }); } catch { /* the screen is gone */ } }
        finally { pump(); }
    }
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.hidden}>
        {uri ? <WebView<object> ref={web} source={{ uri }} onLoadEnd={() => { loaded.current = true; pump(); }} onMessage={event => receive(event.nativeEvent.data)}
            onError={breakAll} onContentProcessDidTerminate={breakAll} onRenderProcessGone={breakAll}
            // '*' hands every URL to the strict callback below; with a narrower list react-native-webview opens the rest in the OS browser itself.
            originWhitelist={['*']} onShouldStartLoadWithRequest={request => allowsVisionNavigation(request.url, uri)}
            allowingReadAccessToURL={uri} allowFileAccess allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
            javaScriptEnabled domStorageEnabled={false} cacheEnabled={false} incognito mixedContentMode="never" setSupportMultipleWindows={false} mediaPlaybackRequiresUserAction
            // Capture is denied outright here (iOS); the page also removes getUserMedia in any document not loaded with #live.
            mediaCapturePermissionGrantType="deny"
        /> : null}
    </View>;
}
const styles = StyleSheet.create({ hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' } });
