import { Stack } from 'expo-router';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { styles } from './fullEditorStyles';

/** Full-screen state before the document is in: the spinner while loading, or the message with Retry and Back. Never both. */
export function EditorLoadState({ problem, onRetry, onBack }: { problem: string | null; onRetry: () => void; onBack: () => void }) {
    useAnnouncement(problem);
    return <View style={styles.loading}>
        <Stack.Screen options={{ title: t('editor.title') }} />
        {problem === null ? <LoadingSkeleton label={t('editor.fullLoading')} variant="dashboard" /> : <Text variant="inherit" style={styles.muted}>{problem}</Text>}
        {problem !== null ? <View style={styles.loadingActions}><Button label={t('editor.retryNow')} onPress={onRetry} /><Button label={t('common.back')} variant="tertiary" onPress={onBack} /></View> : null}
    </View>;
}
