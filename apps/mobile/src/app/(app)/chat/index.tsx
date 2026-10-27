import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, pinnedFirst } from '../../../lib/chat';
import { Text, Button, Icon, themedStyles, useThemedStyles } from '../../../components/ui';

// The website opens on the working conversation, with its thread rail beside it. A phone cannot keep that rail open
// without squeezing the composer, so this route opens the conversation and the Chats button reveals the rail on demand.
export default function ChatWorkspaceEntry() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const opening = useRef(false);
    const [error, setError] = useState(false);

    const openWorkspace = useCallback(async () => {
        if (opening.current) return;
        opening.current = true;
        setError(false);
        try {
            const threads = pinnedFirst(await chatApi(api).listThreads());
            if (threads[0]) {
                router.replace({ pathname: '/chat/[id]', params: { id: threads[0].id } });
            } else {
                router.replace('/chat/new');
            }
        } catch {
            opening.current = false;
            setError(true);
        }
    }, [api, router]);

    useFocusEffect(
        useCallback(() => {
            void openWorkspace();
            return () => {
                opening.current = false;
            };
        }, [openWorkspace]),
    );

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'LLM Chat' }} />
            <View style={styles.brandMark}><Icon name="chat" /></View>
            <Text variant="caption" style={styles.eyebrow}>LLM Chat</Text>
            <Text variant="display" accessibilityRole="header" style={styles.hero}>{error ? 'Could not load your workspace' : 'Opening your workspace'}</Text>
            <Text variant="callout" style={styles.help}>{error ? 'Check your connection and try again.' : 'Your latest conversation, tools and creative skills are being prepared.'}</Text>
            {error ? (
                <Button accessibilityRole="button" containerStyle={styles.retry} onPress={() => void openWorkspace()} variant="tertiary" size="md" label={"Try again"}>
                    <Text variant="callout" style={styles.retryText}>Try again</Text>
                </Button>
            ) : <ActivityIndicator color={styles.accentInk.color} size="small" style={styles.spinner} />}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
    brandMark: { width: 56, height: 56, borderRadius: 18, backgroundColor: p.accentSubtle, borderWidth: 1, borderColor: p.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
    eyebrow: { color: p.accent },
    hero: { color: p.textPrimary, textAlign: 'center', marginTop: 6 },
    help: { color: p.textTertiary, textAlign: 'center', marginTop: 10, maxWidth: 320 },
    spinner: { marginTop: 26 },
    retry: { minHeight: 48, minWidth: 132, marginTop: 24, alignItems: 'center', justifyContent: 'center' },
    retryText: { color: p.textPrimary },
}));
