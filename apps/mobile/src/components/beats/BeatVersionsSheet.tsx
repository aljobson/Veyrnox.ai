import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { t } from '../../lib/i18n';
import { versionEdit, versionReason, versionTime } from '../../lib/beatNative/versions';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatVersion } from '../../lib/beatNative/cloud';
import type { BeatCloudSync, SyncView } from '../../lib/beatNative/cloudSync';
import { ds } from '../../theme';
export function BeatVersionsSheet({ sync, view, apply, onClose }: { sync: BeatCloudSync; view: SyncView; apply(edit: Edit, label?: string): boolean; onClose(): void }) {
    const [rows, setRows] = useState<BeatVersion[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const live = useRef(true), s = useThemedStyles(sheets);
    const allowed = !['checking', 'off', 'signed_out', 'other', 'unlinked', 'removed'].includes(view.state);
    const load = useCallback(async () => {
        if (!allowed) return;
        const token = sync.capture(); setBusy(true); setError(false);
        try { const result = await sync.cloud.versions(sync.id, token); if (live.current && token.current()) setRows(result.versions); }
        catch (error) { await sync.readFailed(error); if (live.current && token.current()) setError(true); }
        finally { if (live.current && token.current()) setBusy(false); }
    }, [sync, allowed]);
    useEffect(() => { live.current = true; setRows([]); void load(); return () => { live.current = false; }; }, [load]);
    const restore = async (row: BeatVersion) => {
        const token = sync.capture(); setBusy(true); setError(false);
        try {
            const result = await sync.cloud.version(sync.id, row.id, token);
            if (!live.current || !token.current()) return;
            if (!apply(versionEdit(result.doc_json, sync.id), t('beat.versions.restore'))) throw new Error('edit_refused');
            // The edit is already applied; local save status owns persistence failures.
            await sync.store.flushBeat(sync.id).catch(() => undefined);
            if (live.current && token.current()) onClose();
        } catch (error) { await sync.readFailed(error); if (live.current && token.current()) setError(true); }
        finally { if (live.current && token.current()) setBusy(false); }
    };
    return <BeatModal title={t('beat.versions.title')} onClose={onClose}>
        <Button label={t('beat.versions.close')} variant="tertiary" onPress={onClose} />
        {!allowed ? <Text accessibilityLiveRegion="polite">{t(view.state === 'off' ? 'beat.cloud.off' : 'beat.versions.linkFirst')}</Text> : <>
            {view.state === 'paused_conflict' ? <Text accessibilityLiveRegion="polite">{t('beat.cloud.paused_conflict')}</Text> : null}
            <Button label={t('beat.versions.save')} disabled={busy || view.busy || !!view.conflict || view.state === 'paused_conflict'} onPress={() => {
                setBusy(true); setError(false);
                void sync.cycle('checkpoint').then(ok => { if (!live.current) return; if (ok) void load(); else { setBusy(false); setError(true); } });
            }} />
            {busy ? <Text accessibilityLiveRegion="polite">{t('beat.versions.loading')}</Text> : null}
            {error ? <><Text accessibilityRole="alert" tone="danger">{t('beat.versions.error')}</Text><Button label={t('beat.retry')} onPress={() => void load()} /></> : null}
            {!busy && !error && !rows.length ? <Text>{t('beat.versions.empty')}</Text> : null}
            {rows.map(row => <View key={row.id} style={s.row}>
                <Text variant="bodyStrong">{row.title}</Text>
                <Text tone="secondary">{t('beat.versions.description', { time: versionTime(row.saved_at), revision: row.revision, reason: versionReason(row.reason) })}</Text>
                <Button label={t('beat.versions.restore')} accessibilityLabel={t('beat.versions.restoreNamed', { title: row.title, revision: row.revision })} disabled={busy || view.busy} onPress={() => void restore(row)} />
            </View>)}
        </>}
    </BeatModal>;
}
const sheets = themedStyles(() => ({ row: { gap: ds.space.sm } }));
