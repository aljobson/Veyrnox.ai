import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { ApiError, type ApiClient } from '../lib/api';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { discardCacheCopy } from '../lib/cacheFiles';
import { t } from '../lib/i18n';
import type { UploadPick } from '../lib/publishMediaChoice';
import { assertAttempt, listUploads, prepareImage, publishUploadMessage, removeUpload, SOCIAL_UPLOAD_TYPES, uploadToPublish, type UploadRow } from '../lib/publishUploads';
import { colors } from '../theme';

type Props = {
    api: ApiClient; enabled: boolean; selectedUploads: UploadPick[]; max?: number; nonUploadCount?: number;
    onSelect: (picks: UploadPick[]) => void; onBusyChange: (busy: boolean) => void;
};
export function PublishUploadPanel(props: Props) {
    const { api, enabled, selectedUploads, max = 1, nonUploadCount = 0 } = props;
    const callbacks = useRef(props); callbacks.current = props;
    const limit = Math.max(0, max);
    // A single-file pick replaces either the current upload or job choice.
    const remaining = limit === 1 ? 1 : Math.max(0, limit - Math.max(0, nonUploadCount) - selectedUploads.length);
    const capacity = () => {
        const total = Math.max(0, callbacks.current.max ?? 1);
        return total === 1 ? 1 : Math.max(0, total
            - Math.max(0, callbacks.current.nonUploadCount ?? 0) - callbacks.current.selectedUploads.length);
    };
    const mounted = useRef(false);
    const accountGen = useRef(0);
    const controller = useRef<AbortController | null>(null);
    const working = useRef(false);
    const copies = useRef(new Set<string>());
    const [rows, setRows] = useState<UploadRow[]>([]);
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [hidden, setHidden] = useState(false);
    const hiddenRef = useRef(false);
    function showMessage(text: string | null, error = false) { setMessage(text ? { text, error } : null); }
    const fence = () => {
        const owner = getCacheUser(), gen = accountGen.current;
        return () => gen === accountGen.current && getCacheUser() === owner;
    };
    const discard = () => { copies.current.forEach(discardCacheCopy); copies.current.clear(); };
    function hide() {
        controller.current?.abort(); discard(); hiddenRef.current = true; setHidden(true); setChecked(false); showMessage(null); setRows([]);
        callbacks.current.onSelect([]);
    }
    function showError(err: unknown) {
        if (err instanceof ApiError && err.status === 503 && err.code === 'uploads_not_open') { hide(); return; }
        const key = publishUploadMessage(err);
        showMessage(key ? t(key) + (err instanceof ApiError && err.body.reservationRemoved ? ` ${t('publishUploads.removed')}` : '') : null, !(err instanceof ApiError && err.code === 'upload_cancelled'));
    }
    async function load() {
        if (!callbacks.current.enabled || hiddenRef.current) return;
        const live = fence();
        setLoadFailed(false);
        try {
            const next = await listUploads(callbacks.current.api);
            if (mounted.current && live() && callbacks.current.enabled && !hiddenRef.current) setRows(next);
        } catch (err) {
            if (!mounted.current || !live() || !callbacks.current.enabled) return;
            if (err instanceof ApiError && err.code === 'uploads_not_open' && err.status === 503) hide();
            else setLoadFailed(true);
        }
    }
    useEffect(() => {
        mounted.current = true;
        const off = subscribeCacheUser(() => {
            accountGen.current++;
            controller.current?.abort(); discard();
            setRows([]); setChecked(false); showMessage(null); setProgress(null); setLoadFailed(false);
            setBusy(false); callbacks.current.onBusyChange(false); callbacks.current.onSelect([]);
            hiddenRef.current = false; setHidden(false); void load();
        });
        return () => {
            mounted.current = false; off(); controller.current?.abort(); discard();
            // Revision 3: no callbacks after unmount; same-account reservation cleanup still runs.
        };
    }, []);
    useEffect(() => {
        if (enabled) void load();
        else {
            controller.current?.abort(); discard(); setRows([]); setChecked(false); showMessage(null);
            if (callbacks.current.selectedUploads.length) callbacks.current.onSelect([]);
        }
    }, [enabled]); // A route closure lasts until the account changes.

    async function pick(source: 'library' | 'files' | 'camera') {
        if (!enabled || hidden || !checked || working.current || capacity() === 0) return;
        working.current = true;
        const live = fence(), abort = new AbortController(); controller.current = abort;
        const active = () => mounted.current && live();
        const attemptCopies = new Set<string>();
        const remember = (uri: string) => { attemptCopies.add(uri); copies.current.add(uri); };
        setBusy(true); callbacks.current.onBusyChange(true); setChecked(false); showMessage(null);
        try {
            let assets: { uri: string; mimeType?: string }[] = [];
            if (source === 'files') {
                const result = await DocumentPicker.getDocumentAsync({ type: [...SOCIAL_UPLOAD_TYPES], copyToCacheDirectory: true, multiple: max > 1 });
                assets = result.canceled ? [] : result.assets;
            } else {
                if (source === 'camera') {
                    const permission = await ImagePicker.requestCameraPermissionsAsync();
                    assertAttempt(live, abort.signal);
                    if (!permission.granted) { if (active()) showMessage(t('publishUploads.cameraDenied'), true); return; }
                }
                const result = source === 'camera'
                    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false, base64: false })
                    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: max > 1, orderedSelection: true, selectionLimit: remaining, allowsEditing: false, quality: 1, exif: false, base64: false });
                assets = result.canceled ? [] : result.assets;
            }
            assets.forEach(asset => remember(asset.uri));
            assertAttempt(live, abort.signal);
            if (!assets.length) return;
            if (assets.length > capacity()) {
                if (active()) showMessage(t('app.publish.carousel.limit', { count: assets.length + selectedUploads.length + nonUploadCount, max: limit }), true);
                return;
            }
            let next = (callbacks.current.max ?? 1) === 1 ? [] : [...callbacks.current.selectedUploads];
            for (const asset of assets) {
                const file = await prepareImage(asset, { accountLive: live, signal: abort.signal });
                remember(file.uri); assertAttempt(live, abort.signal);
                if (active()) setProgress(0);
                const row = await uploadToPublish(api, file, { accountLive: live, signal: abort.signal,
                    onProgress: (value) => { if (active() && !abort.signal.aborted) setProgress(Math.max(0, Math.min(1, value))); },
                });
                assertAttempt(live, abort.signal);
                if (!active()) return;
                setRows(old => [row, ...old.filter(r => r.id !== row.id)]);
                next = [...next, { uploadId: row.id, mediaType: row.mime_type.startsWith('video/') ? 'video' : 'image' }];
                callbacks.current.onSelect(next);
            }
            showMessage(t('publishUploads.selectedNotice'));
        } catch (err) { if (active()) showError(err); }
        finally {
            attemptCopies.forEach(uri => { discardCacheCopy(uri); copies.current.delete(uri); });
            working.current = false;
            if (active()) { setBusy(false); setProgress(null); setChecked(false); callbacks.current.onBusyChange(false); }
        }
    }
    function select(row: UploadRow) {
        if (working.current || !callbacks.current.enabled || hiddenRef.current) return;
        const item: UploadPick = { uploadId: row.id, mediaType: row.mime_type.startsWith('video/') ? 'video' : 'image' };
        const current = callbacks.current.selectedUploads;
        if ((callbacks.current.max ?? 1) === 1) callbacks.current.onSelect([item]);
        else if (current.some(p => p.uploadId === row.id)) callbacks.current.onSelect(current.filter(p => p.uploadId !== row.id));
        else if (capacity() > 0) callbacks.current.onSelect([...current, item]);
        else return;
        showMessage(t('publishUploads.selectedNotice'));
    }
    async function remove(row: UploadRow) {
        if (working.current || !enabled || hidden) return;
        const live = fence();
        try {
            await removeUpload(api, row.id);
            if (!mounted.current || !live() || !callbacks.current.enabled) return;
            setRows(old => old.filter(r => r.id !== row.id));
            if (callbacks.current.selectedUploads.some(item => item.uploadId === row.id)) callbacks.current.onSelect(callbacks.current.selectedUploads.filter(item => item.uploadId !== row.id));
            showMessage(t('publishUploads.removed'));
        } catch (err) { if (mounted.current && live() && callbacks.current.enabled) showError(err); }
    }
    if (!enabled || hidden) return null;
    const button = (key: string, action: () => void, disabled = false, selected?: boolean, label = t(key)) => (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }} disabled={disabled} onPress={action} style={[styles.button, touchTarget]}>
            <Text style={styles.text}>{t(key)}</Text>
        </Pressable>
    );
    const rowLabel = (action: 'select' | 'remove', row: UploadRow) =>
        t(`publishUploads.${action}${row.mime_type.startsWith('video/') ? 'Video' : 'Image'}`, { size: (row.size_bytes / 1048576).toFixed(1) });
    return <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.heading}>{t('publishUploads.title')}</Text>
        <Text style={styles.text}>{t('publishUploads.limits')}</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={t('publishUploads.rights')} accessibilityState={{ checked, disabled: busy }} disabled={busy} onPress={() => setChecked(v => !v)} style={touchTarget}>
            <Text style={styles.text}>{checked ? '☑ ' : '☐ '}{t('publishUploads.rights')}</Text>
        </Pressable>
        {button('publishUploads.library', () => void pick('library'), !checked || busy || remaining === 0)}
        {button('publishUploads.files', () => void pick('files'), !checked || busy || remaining === 0)}
        {button('publishUploads.camera', () => void pick('camera'), !checked || busy || remaining === 0)}
        {progress !== null ? <Text style={styles.text} accessibilityRole="progressbar" accessibilityLabel={t('publishUploads.progress')} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
            {progress >= 1 ? t('publishUploads.checking') : t('publishUploads.uploading', { percent: Math.round(progress * 100) })}
        </Text> : null}
        {busy ? button('publishUploads.cancel', () => controller.current?.abort()) : null}
        {message ? <Text accessibilityRole={message.error ? "alert" : "status"} accessibilityLiveRegion="polite" style={styles.text}>{message.text}</Text> : null}
        {loadFailed ? <View><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{t('publishUploads.loadFailed')}</Text>{button('publishUploads.retry', () => void load(), busy)}</View> : null}
        {rows.map(row => <View key={row.id} style={styles.row}>
            {row.mime_type.startsWith('image/') ? <Image source={{ uri: row.url }} cachePolicy="none" transition={0} style={styles.preview} /> : null}
            <Text style={styles.text}>{t(row.mime_type.startsWith('video/') ? 'publishUploads.video' : 'publishUploads.image')} · {t('publishUploads.size', { size: (row.size_bytes / 1048576).toFixed(1) })}</Text>
            {button('publishUploads.select', () => select(row), busy || (remaining === 0 && !selectedUploads.some(item => item.uploadId === row.id)), selectedUploads.some(item => item.uploadId === row.id), rowLabel('select', row))}
            {button('publishUploads.remove', () => void remove(row), busy, undefined, rowLabel('remove', row))}
        </View>)}
    </View>;
}
const styles = StyleSheet.create({
    panel: { gap: 8 }, heading: { color: colors.text, fontSize: 16, fontWeight: '700' }, text: { color: colors.text },
    button: { padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }, row: { gap: 4 }, preview: { width: 80, height: 80 },
});
