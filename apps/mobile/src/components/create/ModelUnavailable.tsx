import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { t } from '../../lib/i18n';
import { Button, Text, useThemedStyles } from '../ui';
import { createFormSheets } from './createFormStyles';

// The Create screen before it has a model: loading, or a failure. Every state carries the same static title, so the
// route's file name never shows. A failure says what happened in words and offers a way out.
// The failure state sits in the screen container, which has no padding of its own: without this it ran edge to edge.
const layout = StyleSheet.create({ failed: { padding: 16, gap: 12 } });

export function ModelUnavailable({ error, fromTemplate }: { error: string | null; fromTemplate: boolean }) {
    const styles = useThemedStyles(createFormSheets);
    const router = useRouter();
    const gone = error === t('form.modelGone');
    const failed = gone || error === t('form.modelLoad');
    return <View style={styles.screen}>
        <Stack.Screen options={{ title: t('label.Create') }} />
        {failed ? <View style={layout.failed}>
            <Text variant="title2" accessibilityRole="header" accessibilityLiveRegion="polite">{error}</Text>
            <Text variant="body" tone="secondary">{t(gone ? 'form.modelGoneBody' : 'form.modelLoadBody')}</Text>
            <Button label={t('form.modelGoneChoose')} onPress={() => router.replace('/create')} />
            <Button variant="secondary" label={t(fromTemplate ? 'form.modelGoneBack' : 'form.modelBack')} onPress={() => (fromTemplate ? router.replace('/create/presets') : router.canGoBack() ? router.back() : router.replace('/create'))} />
        </View> : error ? <Text variant="body" tone="danger" style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : <ActivityIndicator color={styles.accentInk.color} />}
    </View>;
}
