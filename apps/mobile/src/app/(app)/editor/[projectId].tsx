import { useMemo } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { FullEditorScreen } from '../../../components/editor/FullEditorScreen';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { decodeCuts } from '../../../lib/smartCutHandoff';
import { t } from '../../../lib/i18n';

export default function EditorRoute() {
    const { projectId, jobId, bestCut, add, cuts } = useLocalSearchParams<{ projectId: string; jobId?: string; bestCut?: string; add?: string; cuts?: string }>();
    const planned = useMemo(() => decodeCuts(cuts), [cuts]);
    if (!EDITOR_ENABLED) return <View><Stack.Screen options={{ title: t('editor.title') }} /><Text>{t('editor.unavailable')}</Text></View>;
    return <FullEditorScreen key={projectId} projectId={projectId} jobId={jobId} cuts={planned} startBestCut={bestCut === '1'} startAdd={add === '1'} />;
}
