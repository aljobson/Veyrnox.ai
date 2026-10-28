import { rawText } from '../../../lib/i18n/translate';
import { t } from '../../../lib/i18n';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatLibraryErrorMessage, fetchPersonas, type Persona } from '../../../lib/chatLibrary';
import { Text, Button, Card, themedStyles, useThemedStyles } from '../../../components/ui';

export default function Personas() {
    const styles = useThemedStyles(sheets);
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
            <Stack.Screen options={{ title: t('chat.personas') }} />
            {problem ? <Button accessibilityRole="button" containerStyle={styles.retry} onPress={load} variant="tertiary" size="md" label={(problem) + " " + t('chat.tapToRetry')}><Text style={styles.error}>{t('chat.taptoretry', { value1: problem })}</Text></Button> : null}
            {!state && !problem ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : state && !state.enabled ? (
                <Text style={styles.muted}>{t('chat.personasarenotavailableyet')}</Text>
            ) : state ? (
                <>
                    <Button accessibilityRole="button" containerStyle={styles.add} onPress={() => router.push({ pathname: '/chat/persona/[id]', params: { id: 'new' } })} variant="secondary" size="md" label={t('chat.newpersona')}>
                        <Text variant="bodyStrong" style={styles.addText}>{t('chat.newpersona')}</Text>
                    </Button>
                    <FlatList
                        data={state.personas}
                        keyExtractor={(p) => p.id}
                        ListEmptyComponent={<Text style={styles.muted}>{t('chat.apersonaisasavedsetof')}</Text>}
                        renderItem={({ item }) => (
                            <Card accessibilityRole="button" accessibilityLabel={rawText(t('chat.edit', { value1: item.name }))} style={styles.row} onPress={() => router.push({ pathname: '/chat/persona/[id]', params: { id: item.id } })}>
                                <Text variant="body" style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted} numberOfLines={2}>{item.instructions}</Text>
                            </Card>
                        )}
                    />
                </>
            ) : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg, padding: 16, gap: 12 },
    add: { alignItems: 'center' },
    addText: { color: p.textPrimary },
    row: { paddingVertical: 14, borderBottomColor: p.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3, minHeight: 48 },
    name: { color: p.textPrimary },
    muted: { color: p.textTertiary },
    retry: { minHeight: 44, justifyContent: 'center' },
    error: { color: p.danger },
}));
