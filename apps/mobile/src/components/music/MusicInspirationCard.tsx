import { useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { View } from 'react-native';
import { ApiError, type ApiClient } from '../../lib/api';
import { analyzeMusicInspiration, type MusicInspirationResult } from '../../lib/music';
import { uploadMessage, uploadSource } from '../../lib/uploads';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Button, Chip, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';

export const MUSIC_INSPIRATION_MAX_BYTES = 8 * 1024 * 1024;
const inspirationMessage = (error: unknown): string => {
    if (!(error instanceof ApiError)) return uploadMessage(error);
    if (error.code === 'source_too_long' || error.code === 'source_too_large' || error.code === 'source_size_mismatch') return t('music.create.inspiration.limit');
    if (error.code === 'source_not_allowed') return t('music.create.inspiration.notAllowed');
    if (error.code === 'quota_exceeded') return t('music.create.inspiration.dailyLimit');
    if (error.code === 'source_already_used' || error.code === 'idempotency_conflict') return t('music.create.inspiration.alreadyUsed');
    return uploadMessage(error);
};

export function MusicInspirationCard({ api, onApply }: { readonly api: ApiClient; readonly onApply: (brief: string) => void }) {
    const s = useThemedStyles(sheets); const live = useRef(true); const controller = useRef<AbortController | null>(null);
    const resultOwner = useRef<string | undefined>(undefined);
    const [rights, setRights] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
    const [result, setResult] = useState<MusicInspirationResult | null>(null), [message, setMessage] = useState('');
    const pending = useRef<{ key: string; idempotencyKey: string; owner?: string } | null>(null);
    useEffect(() => { const unsubscribe = subscribeCacheUser(() => { controller.current?.abort(); pending.current = null; resultOwner.current = undefined; setResult(null); setMessage(''); setBusy(false); });
        return () => { live.current = false; controller.current?.abort(); unsubscribe(); }; }, []);
    async function analyze(key: string, idempotencyKey: string, owner?: string) {
        const abort = new AbortController(); controller.current = abort; setBusy(true);
        try {
            const analyzed = await analyzeMusicInspiration(api, key, idempotencyKey, abort.signal);
            if (live.current && !abort.signal.aborted && owner && getCacheUser() === owner) {
                resultOwner.current = owner; setResult(analyzed); pending.current = null;
            }
        } catch (error) {
            const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'in_progress' || error.code === 'request_unavailable');
            if (!retryable) pending.current = null;
            if (live.current && !abort.signal.aborted) setMessage(error instanceof ApiError && error.code === 'consent_declined'
                ? t('aiConsent.youneedtoaccepttouseAI') : inspirationMessage(error));
        } finally { if (live.current) setBusy(false); if (controller.current === abort) controller.current = null; }
    }
    async function choose() {
        if (!rights || busy) return;
        setMessage(''); setResult(null);
        const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'], copyToCacheDirectory: true });
        if (picked.canceled || !live.current) return;
        const file = picked.assets[0];
        if (!file.size || file.size > MUSIC_INSPIRATION_MAX_BYTES) { setMessage(t('music.create.inspiration.limit')); return; }
        const mime = file.mimeType === 'audio/x-wav' || file.mimeType === 'audio/wave' ? 'audio/wav' : file.mimeType;
        if (mime !== 'audio/wav' && mime !== 'audio/mpeg') { setMessage(t('music.create.inspiration.type')); return; }
        const abort = new AbortController(); controller.current = abort; setBusy(true); setProgress(0);
        try {
            const key = await uploadSource(api, { uri: file.uri, size: file.size }, mime, setProgress, abort.signal);
            const attempt = { key, idempotencyKey: `music-inspire-${randomUUID()}`, owner: getCacheUser() }; pending.current = attempt;
            if (live.current) setBusy(false); if (controller.current === abort) controller.current = null;
            await analyze(attempt.key, attempt.idempotencyKey, attempt.owner); return;
        } catch (error) {
            if (live.current && !abort.signal.aborted) setMessage(error instanceof ApiError && error.code === 'consent_declined'
                ? t('aiConsent.youneedtoaccepttouseAI') : inspirationMessage(error));
        } finally { if (live.current) setBusy(false); if (controller.current === abort) controller.current = null; }
    }
    return <View style={s.card}>
        <Text variant="title3" accessibilityRole="header">{t('music.create.inspiration.title')}</Text>
        <Text>{t('music.create.inspiration.body')}</Text>
        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: rights }}
            label={t('music.create.inspiration.rights')} onPress={() => setRights(value => !value)} disabled={busy} />
        <Button variant="secondary" label={busy ? t('music.create.inspiration.analyzing') : t('music.create.inspiration.choose')}
            disabled={!rights || busy} onPress={() => void choose()} />
        {pending.current && !busy ? <Button variant="secondary" label={t('music.create.inspiration.retry')}
            onPress={() => { const value = pending.current; if (value) void analyze(value.key, value.idempotencyKey, value.owner); }} /> : null}
        {busy ? <Button variant="tertiary" label={t('music.create.inspiration.cancel')} onPress={() => controller.current?.abort()} /> : null}
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
