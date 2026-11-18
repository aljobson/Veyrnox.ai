import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button, Chip, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';
import { useAuth } from '../../auth/AuthProvider';
import { createShareAttempts, listShareLinks, revokeShareLink } from '../../lib/music/share';
import { probeMusic, type MusicProbe } from '../../lib/music/probe';
import type { MusicShareLink, MusicSongDetail } from '../../lib/music/types';
import { t, rawText } from '../../lib/i18n';
import { ds } from '../../theme';

export function MusicShares({ song }: { song: MusicSongDetail }) {
    const { api } = useAuth(); const s = useThemedStyles(sheets);
    const attempts = useMemo(() => createShareAttempts(api), [api]);
    const [version, setVersion] = useState(song.version_id);
    const [links, setLinks] = useState<MusicProbe<readonly MusicShareLink[]> | null>(null);
    const [busy, setBusy] = useState(false); const lock = useRef(false);
    const [message, setMessage] = useState('');
    const [createdUrl, setCreatedUrl] = useState<string | null>(null);
    const revokeKeys = useRef(new Map<string, string>());
    const live = useRef(true);
    const load = useCallback(async () => {
        const result = await probeMusic(() => listShareLinks(api, song.id));
        if (live.current) setLinks(result);
    }, [api, song.id]);
    useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, [load]);
    async function openSheet(url: string) {
        try { await Share.share({ message: url, url }); }
        catch { if (live.current) setMessage(t('music.shareSheetError')); }
    }
    async function create() {
        if (lock.current) return;
        lock.current = true; setBusy(true); setMessage('');
        const result = await probeMusic(() => attempts.confirm(song.id, version));
        if (live.current) {
            if (result.state === 'on') {
                setCreatedUrl(result.data.url); setMessage(t('music.shareCreated'));
                await load(); await openSheet(result.data.url);
            } else if (result.state === 'off') setLinks(result);
            else setMessage(t(result.status === 0 ? 'music.offline' : 'music.shareRetry'));
            setBusy(false);
        }
        lock.current = false;
    }
    async function revoke(id: string) {
        if (lock.current) return;
        lock.current = true; setBusy(true); setMessage('');
        const key = revokeKeys.current.get(id) ?? randomUUID(); revokeKeys.current.set(id, key);
        const result = await probeMusic(() => revokeShareLink(api, id, key));
        if (live.current) {
            if (result.state === 'on') { revokeKeys.current.delete(id); setCreatedUrl(null); setMessage(t('music.shareRevoked')); await load(); }
            else if (result.state === 'off') setLinks(result);
            else setMessage(t(result.status === 0 ? 'music.offline' : 'music.writeError'));
            setBusy(false);
        }
        lock.current = false;
    }
    if (links?.state === 'off') return <MusicNotice message={t('music.shareOff')} />;
    return <View style={s.box}>
        <Text variant="title3" accessibilityRole="header">{t('music.share')}</Text>
        {links?.state === 'error' ? <MusicNotice message={t(links.status === 0 ? 'music.offline' : 'music.shareLoadError')} retry={() => void load()} /> : null}
        {message ? <MusicNotice message={message} /> : null}
        {busy ? <MusicNotice message={t('music.saving')} /> : null}
        <Text variant="footnote">{t('music.shareVersion')}</Text>
        <View style={s.versions}>{song.versions.map(v => <Chip key={v.id} disabled={busy} selected={version === v.id}
            label={t('music.version', { number: v.version_number })} onPress={() => { attempts.select(v.id); setVersion(v.id); setCreatedUrl(null); setMessage(''); }} />)}</View>
        <Button variant="secondary" disabled={busy} label={t('music.createShare')} onPress={() => Alert.alert(rawText(t('music.createShare')), rawText(t('music.shareConfirm')), [
            { text: rawText(t('music.cancel')), style: 'cancel' }, { text: rawText(t('music.createShare')), onPress: () => void create() },
        ])} />
        {createdUrl ? <Button variant="secondary" label={t('music.openShare')} disabled={busy} onPress={() => void openSheet(createdUrl)} /> : null}
        {links?.state === 'on' && links.data.length === 0 ? <Text variant="callout">{t('music.noShares')}</Text> : null}
        {links?.state === 'on' ? links.data.map(link => <View key={link.id} style={s.box}>
            <Text variant="footnote">{t('music.linkCreated', { date: link.created_at })}</Text>
            <Text variant="footnote">{t(link.revoked_at ? 'music.linkRevoked' : 'music.linkActive')}</Text>
            {!link.revoked_at ? <Button variant="tertiary" disabled={busy} label={t('music.revoke')} accessibilityLabel={t('music.revokeNamed', { date: link.created_at })} onPress={() => void revoke(link.id)} /> : null}
        </View>) : null}
    </View>;
}
const sheets = themedStyles(() => ({ box: { gap: ds.space.md }, versions: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
