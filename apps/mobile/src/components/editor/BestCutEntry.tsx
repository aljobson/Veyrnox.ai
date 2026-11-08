import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { createProject } from '../../lib/editorProjects';
import { fetchWorkspaces } from '../../lib/projects';
import { t } from '../../lib/i18n';
import { Card, Button, Text } from '../ui';
import { useBestCutAvailability } from './useBestCutAvailability';
export function BestCutEntry() {
    const { api, beginSessionTask } = useAuth(), router = useRouter();
    const { quote } = useBestCutAvailability(api), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    if (!quote) return null;
    async function open() {
        if (busy) return; setBusy(true); setError(false); const task = beginSessionTask();
        try {
            const workspaces = await fetchWorkspaces(api); if (!task.current()) return;
            const workspace = workspaces.find(w => w.isDefault) || workspaces[0]; if (!workspace) throw new Error('no_workspace');
            const project = await createProject(api, workspace.id, t('bestCut.title'), randomUUID());
            if (task.current()) router.push({ pathname: '/editor/[projectId]', params: { projectId: project.id, bestCut: '1' } });
        } catch { if (task.current()) setError(true); } finally { if (task.current()) setBusy(false); }
    }
    return <Card style={{ padding: 16, gap: 12 }}><Text variant="title2">{t('bestCut.title')}</Text><Text>{t('bestCut.intro')}</Text>
        <Button label={t('bestCut.title')} disabled={busy} onPress={() => void open()} />{error ? <Text>{t('common.error')}</Text> : null}</Card>;
}
