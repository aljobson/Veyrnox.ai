import { Stack } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Button } from '../ui/Button';
import { styles } from './fullEditorStyles';

/** Full-screen state before the document is in: the spinner while loading, or the message with Retry and Back. Never both. */
export function EditorLoadState({ problem, onRetry, onBack }: { problem: string | null; onRetry: () => void; onBack: () => void }) {
    return <View style={styles.loading}>
        <Stack.Screen options={{ title: t('editor.title') }} />
        {problem === null ? <ActivityIndicator color={colors.accent} /> : null}
        <Text style={styles.muted} accessibilityLiveRegion="polite">{problem ?? t('editor.fullLoading')}</Text>
        {problem !== null ? <View style={styles.loadingActions}><Button label={t('editor.retryNow')} onPress={onRetry} /><Button label={t('common.back')} variant="tertiary" onPress={onBack} /></View> : null}
    </View>;
}
