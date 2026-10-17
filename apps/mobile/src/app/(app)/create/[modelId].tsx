import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { estimateCredits, fetchCatalog, kindOf, mediaApi, type CatalogModel } from '../../../lib/media';
import { colors } from '../../../theme';

const MAX_PROMPT = 2000;

export default function CreateWithModel() {
    const { modelId } = useLocalSearchParams<{ modelId: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [model, setModel] = useState<CatalogModel | null>(null);
    const [prompt, setPrompt] = useState('');
    const [duration, setDuration] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The same request keeps its key, so a retry after a dropped connection is charged once.
    const pending = useRef<{ signature: string; key: string } | null>(null);

    useEffect(() => {
        fetchCatalog()
            .then((all) => {
                const found = all.find((m) => m.id === modelId) ?? null;
                setModel(found);
                if (found && kindOf(found.modality) === 'video') setDuration(found.durations[0] ?? 5);
                if (!found) setError('That model is no longer available.');
            })
            .catch(() => setError('Could not load this model.'));
    }, [modelId]);

    if (!model) {
        return <View style={styles.screen}>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
    }

    const isVideo = kindOf(model.modality) === 'video';
    const price = estimateCredits(model, duration);
    const text = prompt.trim();

    async function generate() {
        if (!model || !text || busy) return;
        const signature = `${model.id}|${text}|${duration}`;
        const key = pending.current?.signature === signature ? pending.current.key : Crypto.randomUUID();
        pending.current = { signature, key };
        setBusy(true);
        setError(null);
        try {
            const r = await mediaApi(api).createGeneration({ modelId: model.id, prompt: text, durationSeconds: isVideo ? duration : null, confirmedCredits: price, idempotencyKey: key });
            pending.current = null;
            router.replace({ pathname: '/job/[id]', params: { id: r.job_id } });
        } catch (err) {
            setError(messageFor(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: model.name }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <TextInput
                    style={styles.prompt}
                    value={prompt}
                    onChangeText={setPrompt}
                    placeholder="Describe what to create"
                    placeholderTextColor={colors.muted}
                    multiline
                    maxLength={MAX_PROMPT}
                />
                {isVideo && model.durations.length > 1 ? (
                    <View style={styles.chips}>
                        {model.durations.map((d) => (
                            <Pressable key={d} accessibilityRole="button" style={[styles.chip, duration === d && styles.chipOn]} onPress={() => setDuration(d)}>
                                <Text style={[styles.chipText, duration === d && styles.chipTextOn]}>{d}s</Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <Text style={styles.price}>Costs {price} {price === 1 ? 'credit' : 'credits'}. Refunded if it fails.</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable accessibilityRole="button" disabled={!text || busy} style={[styles.button, (!text || busy) && styles.off]} onPress={generate}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>Generate</Text>}
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function messageFor(err: unknown): string {
    if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
    switch (err.code) {
        case 'insufficient_credits':
            return 'Not enough credits for this.';
        case 'rate_limited':
            return 'Too many requests. Wait a moment.';
        case 'credit_confirmation_mismatch':
            return `The price changed to ${String(err.body.expected_credits ?? 'a new amount')} credits. Check it and try again.`;
        case 'network':
            return 'No connection. Try again; you will not be charged twice.';
        default:
            return 'That could not start. You were not charged.';
    }
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 14 },
    prompt: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, minHeight: 140, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    price: { color: colors.money },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    error: { color: colors.danger },
});
