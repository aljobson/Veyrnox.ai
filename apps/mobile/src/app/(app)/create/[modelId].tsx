import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { CONSENT_DECLINED_MESSAGE } from '../../../lib/aiConsent';
import { ApiError } from '../../../lib/api';
import { OFFLINE_PAID_MESSAGE, OfflineError } from '../../../lib/network';
import { SourcePicker } from '../../../components/SourcePicker';
import { estimateCredits, fetchCatalog, kindOf, mediaApi, promptRequired, textInput, type CatalogModel } from '../../../lib/media';
import { selectedState } from '../../../lib/a11y';
import { missingRequired, slotsFor, toSourceKeys, type SlotName } from '../../../lib/sources';
import { colors } from '../../../theme';
import { plural, t } from '../../../lib/i18n';

const PLACEHOLDER: Record<string, string> = { topic: 'form.topicPlaceholder' };

export default function CreateWithModel() {
    const { modelId, prompt: presetPrompt, duration: presetDuration } = useLocalSearchParams<{ modelId: string; prompt?: string; duration?: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [model, setModel] = useState<CatalogModel | null>(null);
    // A template (ADR-0120) opens this form with its prompt and length filled in; both stay editable.
    const [prompt, setPrompt] = useState(typeof presetPrompt === 'string' ? presetPrompt.slice(0, 4000) : '');
    const [duration, setDuration] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    // Storage keys of the files already uploaded, by slot, and the slots still uploading.
    const [uploaded, setUploaded] = useState<Partial<Record<SlotName, string>>>({});
    const [sending, setSending] = useState<Partial<Record<SlotName, boolean>>>({});
    const [error, setError] = useState<string | null>(null);
    // The same request keeps its key, so a retry after a dropped connection is charged once.
    const pending = useRef<{ signature: string; key: string } | null>(null);

    useEffect(() => {
        fetchCatalog()
            .then((all) => {
                const found = all.find((m) => m.id === modelId) ?? null;
                setModel(found);
                if (found && kindOf(found.modality) === 'video') {
                    const wanted = Number(presetDuration);
                    setDuration(found.durations.includes(wanted) ? wanted : (found.durations[0] ?? 5));
                }
                if (!found) setError(t('form.modelGone'));
            })
            .catch(() => setError(t('form.modelLoad')));
    }, [modelId, presetDuration]);

    if (!model) {
        return <View style={styles.screen}>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
    }

    const isVideo = kindOf(model.modality) === 'video';
    const price = estimateCredits(model, duration);
    const text = prompt.trim();
    const slots = slotsFor(model);
    const sources = toSourceKeys(uploaded);
    const waiting = Object.values(sending).some(Boolean);
    const ready = !waiting && missingRequired(slots, uploaded).length === 0 && (!promptRequired(model) || !!text);
    const text_ = textInput(model);

    async function generate() {
        if (!model || !ready || busy) return;
        const signature = `${model.id}|${text}|${duration}|${sources.map((s) => `${s.slot}:${s.key}`).join(',')}`;
        const key = pending.current?.signature === signature ? pending.current.key : Crypto.randomUUID();
        pending.current = { signature, key };
        setBusy(true);
        setError(null);
        try {
            const r = await mediaApi(api).createGeneration({ modelId: model.id, prompt: text, durationSeconds: isVideo ? duration : null, confirmedCredits: price, idempotencyKey: key, sources, textKey: text_?.key });
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
                {slots.map((s) => (
                    <SourcePicker
                        key={s.slot}
                        slot={s}
                        api={api}
                        onChange={(key) => setUploaded((u) => ({ ...u, [s.slot]: key }))}
                        onBusy={(b) => setSending((x) => ({ ...x, [s.slot]: b }))}
                    />
                ))}
                {text_ ? (
                    <TextInput
                        style={[styles.prompt, text_.key === 'topic' && styles.topic]}
                        value={prompt}
                        onChangeText={setPrompt}
                        placeholder={t(PLACEHOLDER[text_.key] ?? (promptRequired(model) ? 'form.describeCreate' : 'form.describeChange'))}
                        placeholderTextColor={colors.muted}
                        accessibilityLabel={text_.key === 'topic' ? t('form.topic') : t('mobile.prompt')}
                        multiline
                        maxLength={text_.max}
                    />
                ) : null}
                {sources.length ? <Text style={styles.consent}>{t('form.consent')}</Text> : null}
                {isVideo && model.durations.length > 1 ? (
                    <View style={styles.chips}>
                        {model.durations.map((d) => (
                            <Pressable key={d} accessibilityRole="button" accessibilityLabel={plural('form.seconds', d)} accessibilityState={selectedState(duration === d)} style={[styles.chip, duration === d && styles.chipOn]} onPress={() => setDuration(d)}>
                                <Text style={[styles.chipText, duration === d && styles.chipTextOn]}>{d}s</Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <Text style={styles.price}>{plural('form.costs', price)}</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={t('slip.generate')} accessibilityState={{ busy, disabled: !ready || busy }} disabled={!ready || busy} style={[styles.button, (!ready || busy) && styles.off]} onPress={generate}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('slip.generate')}</Text>}
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function messageFor(err: unknown): string {
    if (err instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (!(err instanceof ApiError)) return t('common.error');
    switch (err.code) {
        case 'insufficient_credits':
            return t('form.err.insufficient');
        case 'rate_limited':
            return t('form.err.rate');
        case 'credit_confirmation_mismatch':
            return err.body.expected_credits === undefined ? t('form.err.priceChangedUnknown') : t('form.err.priceChanged', { credits: String(err.body.expected_credits) });
        case 'network':
            return t('form.err.network');
        case 'source_not_found':
            return t('form.err.sourceExpired');
        case 'source_type_unsupported':
        case 'source_slot_invalid':
        case 'source_key_invalid':
            return t('form.err.sourceMismatch');
        case 'topic_refused':
            return t('form.err.topicRefused');
        case 'consent_declined':
            return CONSENT_DECLINED_MESSAGE;
        case 'consent_required':
            return t('form.err.tryAgain');
        default:
            return t('form.err.default');
    }
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 14 },
    topic: { minHeight: 90 },
    prompt: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, minHeight: 140, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    price: { color: colors.money },
    consent: { color: colors.muted, fontSize: 12 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    error: { color: colors.danger },
});
