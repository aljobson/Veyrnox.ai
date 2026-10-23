import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, pinnedFirst } from '../../../lib/chat';
import { colors, fonts, radius } from '../../../theme';

// The website opens on the working conversation, with its thread rail beside it. A phone cannot keep that rail open
// without squeezing the composer, so this route opens the conversation and the Chats button reveals the rail on demand.
export default function ChatWorkspaceEntry() {
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
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>V</Text></View>
            <Text style={styles.eyebrow}>LLM CHAT</Text>
            <Text accessibilityRole="header" style={styles.hero}>Opening your workspace</Text>
            <Text style={styles.help}>Your latest conversation, tools and creative skills are being prepared.</Text>
            {error ? (
                <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void openWorkspace()}>
                    <Text style={styles.retryText}>Try again</Text>
                </Pressable>
            ) : <ActivityIndicator color={colors.accent} size="small" style={styles.spinner} />}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
    brandMark: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
    brandMarkText: { color: colors.accent, fontFamily: fonts.displayHeavy, fontSize: 28 },
    eyebrow: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.4 },
    hero: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 30, lineHeight: 34, letterSpacing: -1, textAlign: 'center', marginTop: 6 },
    help: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, maxWidth: 320 },
    spinner: { marginTop: 26 },
    retry: { minHeight: 48, minWidth: 132, marginTop: 24, paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    retryText: { color: colors.accentInk, fontSize: 15, fontWeight: '700' },
});
