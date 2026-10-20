import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { CONSENT_DECLINED_MESSAGE } from '../../lib/aiConsent';
import { ApiError } from '../../lib/api';
import { MIN_TARGET } from '../../lib/a11y';
import { byPrice, chatMediaModels, cleanMediaPrompt, makeKeyFor, makePrice, MAX_MEDIA_PROMPT, MEDIA_KINDS, supportedDuration, type PendingMake } from '../../lib/chatMedia';
import { plural, t } from '../../lib/i18n';
import { fetchCatalog, kindOf, mediaApi, type CatalogModel, type Kind } from '../../lib/media';
import { OFFLINE_PAID_MESSAGE, OfflineError } from '../../lib/network';
import { colors } from '../../theme';

interface Props {
    readonly visible: boolean;
    readonly initialPrompt?: string;
    readonly onClose: () => void;
}

// A compact Create inside the chat. The price is on the button before anything starts, and nothing starts offline.
export function MakePanel({ visible, initialPrompt = '', onClose }: Props) {
    const { api } = useAuth();
    const router = useRouter();
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
    const [kind, setKind] = useState<Kind>('image');
    const [modelId, setModelId] = useState<string | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [prompt, setPrompt] = useState(initialPrompt);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = useRef<PendingMake | null>(null);

    useEffect(() => {
        if (visible && !catalog) fetchCatalog().then(setCatalog, () => setError(t('chat.make.loadFailed')));
    }, [visible, catalog]);
    useEffect(() => {
        if (visible && initialPrompt) setPrompt(initialPrompt);
    }, [visible, initialPrompt]);

    const models = catalog ? byPrice(chatMediaModels(catalog, kind)) : [];
    const model = models.find((m) => m.id === modelId) ?? models[0] ?? null;
    const length = model ? supportedDuration(model, duration) : null;
    const price = model ? makePrice(model, length) : null;
    const text = cleanMediaPrompt(prompt);
    const ready = !!model && !!text && !busy;

    async function make() {
        if (!model || !ready) return;
        const request = makeKeyFor(pending.current, model, text, length, () => Crypto.randomUUID());
        pending.current = request;
        setBusy(true);
        setError(null);
        try {
            const r = await mediaApi(api).createGeneration({ modelId: model.id, prompt: text, durationSeconds: length, confirmedCredits: makePrice(model, length), idempotencyKey: request.key });
            pending.current = null;
            onClose();
            router.push({ pathname: '/job/[id]', params: { id: r.job_id } });
        } catch (err) {
            setError(messageFor(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.title} accessibilityRole="header">{t('chat.make.title')}</Text>
                <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.kind')}>
                    {MEDIA_KINDS.map((k) => (
                        <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: kind === k }} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => { setKind(k); setModelId(null); setDuration(null); }}>
                            <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{t(`chat.make.kind.${k}`)}</Text>
                        </Pressable>
                    ))}
                </View>
                {catalog === null && !error ? <ActivityIndicator color={colors.accent} /> : null}
                {catalog && models.length === 0 ? <Text style={styles.note}>{t('chat.make.none')}</Text> : null}
                {models.map((m) => (
                    <Pressable key={m.id} accessibilityRole="radio" accessibilityLabel={`${m.name}, ${plural('chat.make.from', makePrice(m, null))}`} accessibilityState={{ selected: m.id === model?.id }} style={[styles.model, m.id === model?.id && styles.chipOn]} onPress={() => { setModelId(m.id); setDuration(null); }}>
                        <Text style={styles.name}>{m.name}</Text>
                        <Text style={styles.note}>{plural('chat.make.from', makePrice(m, null))}</Text>
                    </Pressable>
                ))}
                {model && kindOf(model.modality) === 'video' && model.durations.length > 1 ? (
                    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.length')}>
                        {model.durations.map((d) => (
                            <Pressable key={d} accessibilityRole="radio" accessibilityState={{ selected: length === d }} style={[styles.chip, length === d && styles.chipOn]} onPress={() => setDuration(d)}>
                                <Text style={[styles.chipText, length === d && styles.chipTextOn]}>{t('chat.make.seconds', { n: String(d) })}</Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <TextInput style={styles.input} value={prompt} onChangeText={setPrompt} multiline maxLength={MAX_MEDIA_PROMPT} placeholder={t('chat.make.placeholder')} accessibilityLabel={t('chat.make.promptLabel')} placeholderTextColor={colors.muted} />
                <Text style={styles.note}>{t('chat.make.more')}</Text>
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={price !== null ? plural('chat.make.buttonLabel', price) : t('chat.make.button')} disabled={!ready} style={[styles.go, !ready && styles.off]} onPress={make}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.goText}>{price !== null ? plural('chat.make.buttonPrice', price) : t('chat.make.button')}</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.close} onPress={onClose}><Text style={styles.closeText}>{t('chat.make.close')}</Text></Pressable>
            </ScrollView>
        </Modal>
    );
}

function messageFor(err: unknown): string {
    if (err instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (err instanceof Error && err.message === CONSENT_DECLINED_MESSAGE) return CONSENT_DECLINED_MESSAGE;
    if (err instanceof ApiError) {
        if (err.code === 'insufficient_credits') return t('chat.make.err.credits');
        if (err.code === 'rate_limited') return t('chat.make.err.rate');
        if (err.code === 'network') return t('chat.make.err.network');
    }
    return t('chat.make.err.later');
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingTop: 56, gap: 12 },
    title: { color: colors.text, fontSize: 20, fontWeight: '600' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
    chipOn: { borderColor: colors.accent, backgroundColor: colors.surface },
    chipText: { color: colors.muted },
    chipTextOn: { color: colors.accent },
    model: { minHeight: MIN_TARGET, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
    name: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
    input: { color: colors.text, backgroundColor: colors.surface, borderRadius: 12, padding: 12, minHeight: 96, maxHeight: 200 },
    error: { color: colors.danger },
    go: { minHeight: MIN_TARGET, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    goText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
    close: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: colors.accent },
});
