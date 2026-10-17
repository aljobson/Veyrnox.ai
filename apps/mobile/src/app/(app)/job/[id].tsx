import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { mediaApi, waitForJob, type JobState } from '../../../lib/media';
import { colors } from '../../../theme';

const LABEL: Record<JobState, string> = {
    queued: 'In the queue…',
    running: 'Creating…',
    succeeded: 'Done',
    failed: 'This did not finish. Your credits were refunded.',
};

export default function JobScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const [state, setState] = useState<JobState>('queued');
    const [asset, setAsset] = useState<{ url: string; mime: string } | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const media = mediaApi(api);
        waitForJob(media, id, setState, controller.signal)
            .then(async (final) => {
                if (final !== 'succeeded' || controller.signal.aborted) return;
                const a = await media.getAsset(id);
                setAsset({ url: a.url, mime: a.mime_type });
            })
            .catch(() => !controller.signal.aborted && setError(true));
        return () => controller.abort();
    }, [api, id]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Your creation' }} />
            {error ? (
                <Text style={styles.error}>Could not check this job. It is safe to leave; it will appear in your library.</Text>
            ) : asset ? (
                asset.mime.startsWith('image/') ? (
                    <Image source={{ uri: asset.url }} style={styles.image} contentFit="contain" />
                ) : (
                    <Pressable accessibilityRole="button" style={styles.button} onPress={() => WebBrowser.openBrowserAsync(asset.url)}>
                        <Text style={styles.buttonText}>{asset.mime.startsWith('video/') ? 'Play video' : 'Play audio'}</Text>
                    </Pressable>
                )
            ) : (
                <View style={styles.center}>
                    {state === 'queued' || state === 'running' ? <ActivityIndicator color={colors.accent} /> : null}
                    <Text style={state === 'failed' ? styles.error : styles.status}>{LABEL[state]}</Text>
                </View>
            )}
            {asset ? (
                <Link href={{ pathname: '/report', params: { kind: 'job', id } }} asChild>
                    <Pressable accessibilityRole="button" style={styles.report}>
                        <Text style={styles.reportText}>Report this creation</Text>
                    </Pressable>
                </Link>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, justifyContent: 'center' },
    center: { alignItems: 'center', gap: 12 },
    status: { color: colors.body, fontSize: 16 },
    error: { color: colors.danger, textAlign: 'center' },
    image: { flex: 1, width: '100%' },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    report: { paddingVertical: 14, alignItems: 'center' },
    reportText: { color: colors.muted },
});
