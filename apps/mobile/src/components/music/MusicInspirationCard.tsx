import { useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { View } from 'react-native';
import { ApiError, type ApiClient } from '../../lib/api';
import { analyzeMusicInspiration, type MusicInspirationResult, type MusicInspirationSource } from '../../lib/music';
import { prepareMusicInspirationImage } from '../../lib/music/inspirationImage';
import { uploadMessage, uploadSource } from '../../lib/uploads';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { discardCacheCopy } from '../../lib/cacheFiles';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Button, Chip, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';

export const MUSIC_INSPIRATION_MAX_BYTES = 8 * 1024 * 1024;
const inspirationMessage = (error: unknown, kind: MusicInspirationSource): string => {
    if (!(error instanceof ApiError)) return uploadMessage(error);
    if (kind === 'image') {
        if (error.code === 'source_too_large') return t('music.create.inspiration.imageLimit');
        if (['source_size_mismatch', 'source_not_supported', 'upload_unreadable', 'upload_dimensions_too_large', 'upload_type_mismatch'].includes(error.code)) {
            return t('music.create.inspiration.imageType');
        }
    }
    if (error.code === 'source_too_long' || error.code === 'source_too_large' || error.code === 'source_size_mismatch') return t('music.create.inspiration.limit');
    if (error.code === 'source_not_allowed') return t('music.create.inspiration.notAllowed');
    if (error.code === 'quota_exceeded') return t('music.create.inspiration.dailyLimit');
    if (error.code === 'source_already_used' || error.code === 'idempotency_conflict') return t('music.create.inspiration.alreadyUsed');
    return uploadMessage(error);
};

export function MusicInspirationCard({ api, sources, onApply }: { readonly api: ApiClient; readonly sources: readonly MusicInspirationSource[]; readonly onApply: (brief: string) => void }) {
    const s = useThemedStyles(sheets); const live = useRef(true); const controller = useRef<AbortController | null>(null);
    const starting = useRef(false), preparation = useRef(0);
    const resultOwner = useRef<string | undefined>(undefined);
    const [rights, setRights] = useState(false), [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false), [progress, setProgress] = useState(0);
    const [result, setResult] = useState<MusicInspirationResult | null>(null), [message, setMessage] = useState('');
    const [pending, setPending] = useState<{ kind: MusicInspirationSource; key: string; idempotencyKey: string; owner?: string } | null>(null);
    useEffect(() => { const unsubscribe = subscribeCacheUser(() => { controller.current?.abort(); preparation.current++; starting.current = false; setPreparing(false); setPending(null); resultOwner.current = undefined; setResult(null); setMessage(''); setBusy(false); });
        return () => { live.current = false; controller.current?.abort(); unsubscribe(); }; }, []);
    function beginSelection() {
        if (!rights || busy || starting.current) return null;
        starting.current = true; const version = ++preparation.current; setPreparing(true); setMessage(''); setResult(null); setPending(null);
        return version;
    }
    const selectionCurrent = (version: number) => live.current && preparation.current === version;
    function finishSelection(version: number) {
        if (preparation.current !== version) return;
        starting.current = false; if (live.current) setPreparing(false);
    }
    function cancel() {
        controller.current?.abort(); preparation.current++; starting.current = false; setPreparing(false);
    }
    async function analyze(kind: MusicInspirationSource, key: string, idempotencyKey: string, owner?: string) {
        const abort = new AbortController(); controller.current = abort; setBusy(true);
        try {
            const analyzed = await analyzeMusicInspiration(api, kind, key, idempotencyKey, abort.signal);
            if (live.current && !abort.signal.aborted && owner && getCacheUser() === owner) {
                resultOwner.current = owner; setResult(analyzed); setPending(null);
            }
        } catch (error) {
            const retryable = abort.signal.aborted || error instanceof ApiError
                && (error.status === 0 || error.status >= 500 || error.code === 'in_progress' || error.code === 'request_unavailable');
            if (!retryable && live.current) setPending(null);
            if (live.current && !abort.signal.aborted) setMessage(error instanceof ApiError && error.code === 'consent_declined'
                ? t('aiConsent.youneedtoaccepttouseAI') : inspirationMessage(error, kind));
        } finally { if (live.current) setBusy(false); if (controller.current === abort) controller.current = null; }
    }
    async function upload(kind: MusicInspirationSource, file: { uri: string; size: number }, mime: string, owner?: string, cleanup?: () => void) {
        if (!live.current || !owner || getCacheUser() !== owner) { cleanup?.(); return; }
        const abort = new AbortController(); controller.current = abort; setBusy(true); setProgress(0);
        try {
            const key = await uploadSource(api, file, mime, setProgress, abort.signal);
            if (!live.current || getCacheUser() !== owner) return;
            const attempt = { kind, key, idempotencyKey: `music-inspire-${randomUUID()}`, owner }; setPending(attempt);
            cleanup?.(); cleanup = undefined;
            if (live.current) setBusy(false); if (controller.current === abort) controller.current = null;
            await analyze(attempt.kind, attempt.key, attempt.idempotencyKey, attempt.owner); return;
        } catch (error) {
            if (live.current && !abort.signal.aborted) setMessage(error instanceof ApiError && error.code === 'consent_declined'
                ? t('aiConsent.youneedtoaccepttouseAI') : inspirationMessage(error, kind));
        } finally { cleanup?.(); if (live.current) setBusy(false); if (controller.current === abort) controller.current = null; }
    }
    async function chooseAudio() {
        const version = beginSelection(); if (version === null) return;
        const owner = getCacheUser(); let uri: string | undefined;
        try {
            const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'], copyToCacheDirectory: true });
            if (picked.canceled || !selectionCurrent(version)) return;
            const file = picked.assets[0]; uri = file.uri;
            if (!file.size || file.size > MUSIC_INSPIRATION_MAX_BYTES) { setMessage(t('music.create.inspiration.limit')); return; }
            const mime = file.mimeType === 'audio/x-wav' || file.mimeType === 'audio/wave' ? 'audio/wav' : file.mimeType;
            if (mime !== 'audio/wav' && mime !== 'audio/mpeg') { setMessage(t('music.create.inspiration.type')); return; }
            await upload('audio', { uri: file.uri, size: file.size }, mime, owner, () => { discardCacheCopy(file.uri); uri = undefined; });
        } finally { discardCacheCopy(uri); finishSelection(version); }
    }
    async function chooseImage() {
        const version = beginSelection(); if (version === null) return;
        const owner = getCacheUser(); let asset: ImagePicker.ImagePickerAsset | undefined;
        let prepared: Awaited<ReturnType<typeof prepareMusicInspirationImage>> | undefined;
        try {
            const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1,
                exif: false, base64: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
            if (picked.canceled || !selectionCurrent(version)) return;
            asset = picked.assets[0];
            prepared = await prepareMusicInspirationImage(asset);
            if (!selectionCurrent(version)) return;
            const assetUri = asset.uri, preparedUri = prepared.uri;
            const cleanup = () => { discardCacheCopy(assetUri); discardCacheCopy(preparedUri); };
            await upload('image', { uri: prepared.uri, size: prepared.size }, prepared.mimeType, owner, cleanup);
        } catch (error) {
            if (selectionCurrent(version)) setMessage(error instanceof Error && error.message === 'image_too_large'
                ? t('music.create.inspiration.imageLimit') : t('music.create.inspiration.imageType'));
        } finally { discardCacheCopy(asset?.uri); discardCacheCopy(prepared?.uri); finishSelection(version); }
    }
    return <View style={s.card}>
        <Text variant="title3" accessibilityRole="header">{t('music.create.inspiration.title')}</Text>
        <Text>{t('music.create.inspiration.body')}</Text>
        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: rights }}
            label={t('music.create.inspiration.rights')} onPress={() => setRights(value => !value)} disabled={busy || preparing} />
        {sources.includes('audio') ? <Button variant="secondary" label={t('music.create.inspiration.choose')}
            disabled={!rights || busy || preparing} onPress={() => void chooseAudio()} /> : null}
        {sources.includes('image') ? <Button variant="secondary" label={t('music.create.inspiration.chooseImage')}
            disabled={!rights || busy || preparing} onPress={() => void chooseImage()} /> : null}
        {busy || preparing ? <Text>{t('music.create.inspiration.analyzing')}</Text> : null}
        {pending && !busy ? <Button variant="secondary" label={t('music.create.inspiration.retry')}
            onPress={() => void analyze(pending.kind, pending.key, pending.idempotencyKey, pending.owner)} /> : null}
        {busy || preparing ? <Button variant="tertiary" label={t('music.create.inspiration.cancel')} onPress={cancel} /> : null}
        {busy ? <Text>{t('music.create.inspiration.progress', { percent: Math.round(progress * 100) })}</Text> : null}
        {message ? <MusicNotice message={message} /> : null}
        {result ? <View style={s.result}>
            <Text selectable>{result.brief}</Text>
            <View style={s.tags}>{result.tags.map(tag => <Chip key={tag} label={tag} />)}</View>
            <Button label={t('music.create.inspiration.apply')} onPress={() => {
                if (resultOwner.current && getCacheUser() === resultOwner.current) onApply(result.brief);
            }} />
        </View> : null}
    </View>;
}
const sheets = themedStyles(p => ({ card: { gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.lg,
    backgroundColor: p.surface }, result: { gap: ds.space.sm }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.xs } }));
