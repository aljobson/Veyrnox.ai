import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { formatLocale, t } from '../../lib/i18n';
import { fetchVersion, type VersionDocument } from '../../lib/projectDocumentDraft';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { aspectLabel, fpsLabel } from './ProjectDocumentCard';
import { useBeginTask } from './useProjectDocument';

// A saved version, read before restoring it. Restore goes through the document hook like the row button.
export function VersionPreview({ api, id, revision, reason, canRestore, restoring, live, onRestore, onClose }: {
    api: ApiClient; id: string; revision: number; reason: string | null; canRestore: boolean; restoring: boolean;
    live(): boolean; onRestore(): void; onClose(): void;
}) {
    const s = useThemedStyles(sheets);
    const [version, setVersion] = useState<VersionDocument | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const beginTask = useBeginTask();
    useEffect(() => {
        let active = true;
        const task = beginTask();
        const current = () => active && live() && task.current();
        setFailed(false);
        fetchVersion(api, id, revision).then(
            (v) => { if (current()) setVersion(v); },
            () => { if (current()) setFailed(true); },
        );
        return () => { active = false; };
        // live is read at settle time only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, id, revision, attempt, beginTask]);
    const canvas = version?.document.canvas as { aspect_ratio?: unknown; frame_rate?: unknown } | undefined;
    return (
        <Modal visible animationType="none" transparent onRequestClose={() => { if (!restoring) onClose(); }}>
            <View style={s.scrim}>
                <View style={s.sheet} accessibilityViewIsModal>
                    <Text variant="title3" accessibilityRole="header">{t('projectDocument.versionTitle', { value1: revision })}</Text>
                    {failed ? (
                        <>
                            <Text variant="footnote" tone="danger" accessibilityRole="alert">{t('projectDocument.versionFailed')}</Text>
                            <Button variant="secondary" size="md" label={t('projectDocument.retry')} onPress={() => setAttempt((n) => n + 1)} />
                        </>
                    ) : !version ? (
                        <ActivityIndicator accessibilityLabel={t('projectDocument.loadingVersion')} />
                    ) : (
                        <ScrollView style={s.body} contentContainerStyle={s.content}>
                            {version.createdAt ? <Text variant="footnote" tone="secondary">{new Date(version.createdAt).toLocaleString(formatLocale())}</Text> : null}
                            <Text variant="footnote">{aspectLabel(canvas?.aspect_ratio)}</Text>
                            <Text variant="footnote">{fpsLabel(canvas?.frame_rate)}</Text>
                            <Text variant="body">{version.document.brief || t('projectDocument.noBrief')}</Text>
                        </ScrollView>
                    )}
                    {reason ? <Text variant="footnote" tone="secondary">{reason}</Text> : null}
                    <View style={s.actions}>
                        <Button variant="secondary" size="md" label={t('projectDocument.close')} disabled={restoring} onPress={onClose} containerStyle={s.grow} />
                        <Button variant="primary" size="md" label={t('projectDocument.restore')} accessibilityLabel={t('projects.restoreversion2', { value1: revision })} disabled={!canRestore || !version} loading={restoring} onPress={onRestore} containerStyle={s.grow} />
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const sheets = themedStyles((p) => ({
    scrim: { flex: 1, justifyContent: 'center', padding: ds.space.lg, backgroundColor: p.scrim },
    sheet: { gap: ds.space.md, padding: ds.space.lg, borderRadius: ds.radius.lg, backgroundColor: p.bgElevated1, maxHeight: '85%' },
    body: { flexGrow: 0 },
    content: { gap: ds.space.sm },
    actions: { flexDirection: 'row', gap: ds.space.sm },
    grow: { flex: 1 },
}));
