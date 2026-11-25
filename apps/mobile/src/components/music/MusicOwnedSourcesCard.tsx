import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import type { ApiClient } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { discardCacheCopy } from '../../lib/cacheFiles';
import { formatNumber, t } from '../../lib/i18n';
import {
    listMusicSources, normalizeMusicSourceFile, removeMusicSource, uploadMusicSource,
    type MusicOwnedSource, type MusicOwnedSourceFile,
} from '../../lib/music';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';

const fingerprint = (file: MusicOwnedSourceFile): string => `${file.uri}:${file.name}:${file.mimeType}:${file.size}`;
const duration = (seconds: number): string => {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function sourceMessage(error: unknown): string {
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'source_duration_invalid') return t('musicSources.durationInvalid');
    if (code === 'source_duration_unavailable') return t('musicSources.durationUnavailable');
    if (code === 'source_type_not_supported') return t('musicSources.type');
    if (code === 'source_size_invalid') return t('musicSources.size');
    if (code === 'rights_confirmation_required') return t('musicSources.rightsRequired');
    if (code === 'upload_budget_exceeded') return t('musicSources.budget');
    if (code === 'storage_upload_failed' || code === 'upload_url_expired') return t('musicSources.uploadFailed');
    if (code === 'network') return t('musicSources.offline');
    return t('musicSources.error');
}

export function MusicOwnedSourcesCard({ api }: { readonly api: ApiClient }) {
    const s = useThemedStyles(sheets);
    const mounted = useRef(true), controller = useRef<AbortController | null>(null);
    const fileRef = useRef<MusicOwnedSourceFile | null>(null);
    const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
    const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState('');
    const [rights, setRights] = useState(false), [file, setFile] = useState<MusicOwnedSourceFile | null>(null);
    const [sources, setSources] = useState<readonly MusicOwnedSource[]>([]);
    const [progress, setProgress] = useState(0), [message, setMessage] = useState(''), [notice, setNotice] = useState('');

    useEffect(() => {
        mounted.current = true;
        const reset = () => {
            controller.current?.abort(); controller.current = null; attempt.current = null;
            setSources([]); setFile(current => { discardCacheCopy(current?.uri); fileRef.current = null; return null; });
            setOpen(false); setLoading(false); setBusy(''); setRights(false); setProgress(0); setMessage(''); setNotice('');
        };
        const unsubscribe = subscribeCacheUser(reset);
        return () => { mounted.current = false; controller.current?.abort(); discardCacheCopy(fileRef.current?.uri); unsubscribe(); };
        // The latest cache copy is also discarded after upload, replacement, and account reset.
    }, []);

    async function load() {
        const owner = getCacheUser(); if (!owner) return;
        setLoading(true); setMessage('');
        try {
            const next = await listMusicSources(api);
            if (mounted.current && getCacheUser() === owner) setSources(next);
        } catch (error) {
            if (mounted.current && getCacheUser() === owner) setMessage(sourceMessage(error));
        } finally { if (mounted.current && getCacheUser() === owner) setLoading(false); }
    }

    async function choose() {
        if (busy) return;
        setMessage(''); setNotice('');
        const owner = getCacheUser(); if (!owner) return;
        const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'], copyToCacheDirectory: true });
        if (picked.canceled) return;
        if (!mounted.current || getCacheUser() !== owner) { discardCacheCopy(picked.assets[0].uri); return; }
        const next = normalizeMusicSourceFile(picked.assets[0]);
        if (!next) { discardCacheCopy(picked.assets[0].uri); setMessage(t('musicSources.invalid')); return; }
        discardCacheCopy(fileRef.current?.uri); fileRef.current = next; setFile(next); attempt.current = null;
    }

    async function upload() {
        if (!file || !rights || busy) return;
        const owner = getCacheUser(); if (!owner) return;
        const fileFingerprint = fingerprint(file);
        const pending = attempt.current?.fingerprint === fileFingerprint ? attempt.current
            : { fingerprint: fileFingerprint, key: `music-source-${randomUUID()}` };
        attempt.current = pending; setBusy('upload'); setProgress(0); setMessage(''); setNotice('');
        const abort = new AbortController(); controller.current = abort;
        try {
            const source = await uploadMusicSource(api, file, pending.key, value => {
                if (mounted.current && getCacheUser() === owner) setProgress(value);
            }, abort.signal);
            if (!mounted.current || abort.signal.aborted || getCacheUser() !== owner) return;
            attempt.current = null; discardCacheCopy(file.uri); fileRef.current = null; setFile(null); setRights(false);
            setSources(current => [source, ...current.filter(item => item.id !== source.id)]);
            setNotice(t('musicSources.ready'));
        } catch (error) {
            if (mounted.current && !abort.signal.aborted && getCacheUser() === owner) setMessage(sourceMessage(error));
        } finally {
            if (controller.current === abort) controller.current = null;
            if (mounted.current && getCacheUser() === owner) setBusy('');
        }
    }

    async function remove(source: MusicOwnedSource) {
        if (busy) return;
        const owner = getCacheUser(); if (!owner) return;
        setBusy(`remove:${source.id}`); setMessage(''); setNotice('');
        try {
            await removeMusicSource(api, source.id);
            if (mounted.current && getCacheUser() === owner) {
                setSources(current => current.filter(item => item.id !== source.id)); setNotice(t('musicSources.removed'));
            }
        } catch (error) {
            if (mounted.current && getCacheUser() === owner) setMessage(sourceMessage(error));
        } finally { if (mounted.current && getCacheUser() === owner) setBusy(''); }
    }

    if (!open) return <View style={s.card}>
        <Text variant="title3" accessibilityRole="header">{t('musicSources.title')}</Text>
        <Text>{t('musicSources.body')}</Text>
        <Button variant="secondary" label={t('musicSources.open')} onPress={() => { setOpen(true); void load(); }} />
    </View>;

    return <View style={s.card}>
        <Text variant="title3" accessibilityRole="header">{t('musicSources.title')}</Text>
        <Text>{t('musicSources.limits')}</Text>
        <Button variant="secondary" label={t('musicSources.close')} onPress={() => setOpen(false)} disabled={Boolean(busy)} />
        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: rights }}
            label={t('musicSources.rights')} onPress={() => setRights(value => !value)} disabled={Boolean(busy)} />
        <Button variant="secondary" label={t('musicSources.choose')} onPress={() => void choose()} disabled={Boolean(busy)} />
        {file ? <Text>{t('musicSources.selected', { name: file.name, size: formatNumber(file.size / 1024 / 1024, 1) })}</Text> : null}
        <Button label={busy === 'upload' ? t('musicSources.uploading', { percent: Math.round(progress * 100) }) : t('musicSources.upload')}
            onPress={() => void upload()} disabled={!file || !rights || Boolean(busy)} />
        {loading ? <Text>{t('musicSources.loading')}</Text> : null}
        {!loading && sources.length === 0 ? <Text tone="secondary">{t('musicSources.empty')}</Text> : null}
        {sources.map(source => <View key={source.id} style={s.source}>
            <View style={s.sourceText}><Text>{source.filename}</Text>
                <Text variant="caption" tone="secondary">{t('musicSources.summary', { duration: duration(source.duration_seconds) })}</Text></View>
            <Button variant="tertiary" label={t('musicSources.removeNamed', { name: source.filename })}
                onPress={() => void remove(source)} disabled={Boolean(busy)} />
        </View>)}
        {message ? <MusicNotice message={message} retry={message === t('musicSources.error') ? () => void load() : undefined} /> : null}
        {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
    </View>;
}

const sheets = themedStyles(p => ({
    card: { gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.lg, backgroundColor: p.surface },
    source: { gap: ds.space.sm, padding: ds.space.sm, borderRadius: ds.radius.md, backgroundColor: p.bgElevated2 },
    sourceText: { gap: ds.space.xs },
}));
