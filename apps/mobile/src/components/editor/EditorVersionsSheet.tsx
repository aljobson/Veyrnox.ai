import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { isAccountChanged } from '../../auth/sessionTask';
import { fetchHistory, mergeVersions, projectsErrorMessage, type Version } from '../../lib/projects';
import { getDocumentAt, type DocumentHead } from '../../lib/editorProjects';
import { timelineOf } from '../../lib/nativeEditorModel';
import { formatLocale, plural, t } from '../../lib/i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ListRow } from '../ui/ListRow';
import { Text } from '../ui/Text';
import { useAnnouncement } from '../../lib/useAnnouncement';
import type { EditorSaveSync } from './useEditorSaveSync';
import { saveSheetStyles } from './EditorSaveSheets';

export function EditorVersionsSheet({ sync, api, projectId }: { sync: EditorSaveSync; api: ApiClient; projectId: string }) {
    const visible = sync.sheet === 'versions';
    const generation = useRef(0), previewGeneration = useRef(0);
    const [versions, setVersions] = useState<Version[]>([]);
    const [nextBefore, setNextBefore] = useState<number | null>(null);
    const [preview, setPreview] = useState<DocumentHead | null>(null);
    const [busy, setBusy] = useState(false), [previewBusy, setPreviewBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useAnnouncement(error);
    const load = async (before?: number) => {
        if (!sync.live()) return;
        const ticket = generation.current;
        setBusy(true); setError(null);
        try {
            const page = await fetchHistory(api, projectId, before);
            if (!sync.live() || ticket !== generation.current) return;
            setVersions(old => mergeVersions(before === undefined ? [] : old, page.versions).versions.sort((a, b) => b.revision - a.revision));
            setNextBefore(page.nextBefore);
        } catch (err) { if (isAccountChanged(err)) sync.accountChanged(); else if (sync.live() && ticket === generation.current) setError(projectsErrorMessage(err)); }
        finally { if (sync.live() && ticket === generation.current) setBusy(false); }
    };
    useEffect(() => {
        generation.current++; previewGeneration.current++; setPreview(null);
        if (visible) void load();
        return () => { generation.current++; previewGeneration.current++; };
        // A sheet opening starts a new list/preview lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, api, projectId]);
    const select = async (revision: number) => {
        if (!sync.live()) return;
        const ticket = ++previewGeneration.current;
        setPreviewBusy(true); setPreview(null); setError(null);
        try {
            const head = await getDocumentAt(api, projectId, revision);
            if (sync.live() && ticket === previewGeneration.current) { sync.observeHead(head); setPreview(head); }
        } catch (err) { if (isAccountChanged(err)) sync.accountChanged(); else if (sync.live() && ticket === previewGeneration.current) setError(projectsErrorMessage(err)); }
        finally { if (sync.live() && ticket === previewGeneration.current) setPreviewBusy(false); }
    };
    const timeline = timelineOf(preview?.document.timeline);
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={sync.closeVersions} accessibilityViewIsModal>
        <View style={saveSheetStyles.backdrop}><Card style={saveSheetStyles.surface} accessibilityViewIsModal>
            <Text variant="title2" accessibilityRole="header">{t('projects.savedversions')}</Text>
            {error || sync.problem ? <Text accessibilityRole="alert">{error || sync.problem}</Text> : null}
            <ScrollView>
                {versions.map(version => <ListRow key={version.revision}
                    accessibilityLabel={`${t('editorSave.versionRow', { value1: version.revision })}${version.revision === sync.revision ? t('editorSave.current') : ''}`}
                    title={`${t('editorSave.versionRow', { value1: version.revision })}${version.revision === sync.revision ? t('editorSave.current') : ''}`}
                    subtitle={`${version.createdAt ? new Date(version.createdAt).toLocaleString(formatLocale()) : ''}${version.restoredFrom !== null ? ` · ${t('editorSave.restoredFrom', { value1: version.restoredFrom })}` : ''}`}
                    onPress={() => void select(version.revision)} />)}
                {!busy && !versions.length ? <Text>{t('projects.nosavedversionsyet')}</Text> : null}
                {busy || previewBusy ? <ActivityIndicator /> : null}
                {nextBefore !== null ? <Button label={t('editorSave.loadOlder')} disabled={busy} onPress={() => void load(nextBefore)} /> : null}
                {preview ? <Card><Text>{plural('editor.clips2Count', timeline.video.length + timeline.audio.length + timeline.text.length)}</Text>
                    {!sync.restoreUnknown ? <Button label={t('projects.restore')} disabled={sync.dirty || preview.revision === sync.revision || !sync.canStart} onPress={() => sync.restore(preview.revision)} /> : null}
                </Card> : null}
                {sync.dirty ? <Text>{t('editorSave.saveFirst')}</Text> : null}
                {sync.imports > 0 ? <Text>{t('editorSave.waitingImport')}</Text> : null}
                {sync.restoreUnknown ? <>
                    <Button label={t('editorSave.retryRestore')} disabled={!sync.retryAllowed} onPress={() => void sync.retryRestore()} />
                    <Text>{t('editorSave.restoreUnknown')}</Text>
                </> : null}
            </ScrollView>
            <Button label={t('editorSave.close')} variant="tertiary" onPress={sync.closeVersions} />
        </Card></View>
    </Modal>;
}
