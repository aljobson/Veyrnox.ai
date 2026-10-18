import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatLibraryErrorMessage, fetchPersonas, type Persona } from '../../../lib/chatLibrary';
import { colors } from '../../../theme';

export default function Personas() {
    const { api } = useAuth();
    const router = useRouter();
    const [state, setState] = useState<{ enabled: boolean; personas: Persona[] } | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setState(await fetchPersonas(api));
            setProblem(null);
        } catch (err) {
            setProblem(chatLibraryErrorMessage(err));
        }
    }, [api]);

    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Personas' }} />
            {problem ? <Pressable accessibilityRole="button" style={styles.retry} onPress={load}><Text style={styles.error}>{problem} Tap to retry.</Text></Pressable> : null}
            {!state && !problem ? (
                <ActivityIndicator color={colors.accent} />
            ) : state && !state.enabled ? (
                <Text style={styles.muted}>Personas are not available yet.</Text>
            ) : state ? (
                <>
                    <Pressable accessibilityRole="button" style={styles.add} onPress={() => router.push({ pathname: '/chat/persona/[id]', params: { id: 'new' } })}>
                        <Text style={styles.addText}>New persona</Text>
                    </Pressable>
                    <FlatList
                        data={state.personas}
                        keyExtractor={(p) => p.id}
                        ListEmptyComponent={<Text style={styles.muted}>A persona is a saved set of instructions for a chat. None yet.</Text>}
                        renderItem={({ item }) => (
                            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} style={styles.row} onPress={() => router.push({ pathname: '/chat/persona/[id]', params: { id: item.id } })}>
                                <Text style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted} numberOfLines={2}>{item.instructions}</Text>
                            </Pressable>
                        )}
                    />
                </>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    add: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    addText: { color: colors.accentInk, fontWeight: '600', fontSize: 16 },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3, minHeight: 48 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted },
    retry: { minHeight: 44, justifyContent: 'center' },
    error: { color: colors.danger },
});
