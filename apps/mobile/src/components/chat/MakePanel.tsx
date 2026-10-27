import { useReducedMotion } from '../ui/useReducedMotion';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { CONSENT_DECLINED_MESSAGE } from '../../lib/aiConsent';
import { ApiError } from '../../lib/api';
import { MIN_TARGET } from '../../lib/a11y';
import { byPrice, chatMediaModels, cleanMediaPrompt, makeKeyFor, makePrice, MAX_MEDIA_PROMPT, MEDIA_KINDS, supportedDuration, type PendingMake } from '../../lib/chatMedia';
import { plural, t } from '../../lib/i18n';
import { fetchCatalog, kindOf, mediaApi, type CatalogModel, type Kind } from '../../lib/media';
import { OFFLINE_PAID_MESSAGE, OfflineError } from '../../lib/network';
import { Text, TextField, Button, Card, Chip, themedStyles, useThemedStyles } from '../ui';

interface Props {
    readonly visible: boolean;
    readonly initialPrompt?: string;
    readonly initialKind?: Kind;
    readonly onClose: () => void;
}

// A compact Create inside the chat. The price is on the button before anything starts, and nothing starts offline.
export function MakePanel({ visible, initialPrompt = '', initialKind = 'image', onClose }: Props) {
    const styles = useThemedStyles(sheets);
    const reducedMotion = useReducedMotion();
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
        if (!visible) return;
        setKind(initialKind);
        setModelId(null);
        setDuration(null);
        setPrompt(initialPrompt);
    }, [visible, initialPrompt, initialKind]);

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
        <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
            <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text variant="title2" style={styles.title} accessibilityRole="header">{t('chat.make.title')}</Text>
                <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.kind')}>
                    {MEDIA_KINDS.map((k) => (
                        <Chip key={k} accessibilityRole="radio" accessibilityState={{ selected: kind === k }} onPress={() => { setKind(k); setModelId(null); setDuration(null); }} label={(t(`chat.make.kind.${k}`))} selected={kind === k} />
                    ))}
                </View>
                {catalog === null && !error ? <ActivityIndicator color={styles.accentInk.color} /> : null}
                {catalog && models.length === 0 ? <Text variant="footnote" style={styles.note}>{t('chat.make.none')}</Text> : null}
                {models.map((m) => (
                    <Card key={m.id} accessibilityRole="radio" accessibilityLabel={`${m.name}, ${plural('chat.make.from', makePrice(m, null))}`} accessibilityState={{ selected: m.id === model?.id }} style={[styles.model]} onPress={() => { setModelId(m.id); setDuration(null); }} selected={m.id === model?.id}>
                        <Text variant="body" style={styles.name}>{m.name}</Text>
                        <Text variant="footnote" tone="warning">{plural('chat.make.from', makePrice(m, null))}</Text>
                    </Card>
                ))}
                {model && kindOf(model.modality) === 'video' && model.durations.length > 1 ? (
                    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.length')}>
                        {model.durations.map((d) => (
                            <Chip key={d} accessibilityRole="radio" accessibilityState={{ selected: length === d }} onPress={() => setDuration(d)} label={(t('chat.make.seconds', { n: String(d) }))} selected={length === d} />
                        ))}
                    </View>
                ) : null}
                <TextField style={styles.input} value={prompt} onChangeText={setPrompt} multiline maxLength={MAX_MEDIA_PROMPT} placeholder={t('chat.make.placeholder')} accessibilityLabel={t('chat.make.promptLabel')} />
                <Text variant="footnote" style={styles.note}>{t('chat.make.more')}</Text>
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <Button accessibilityRole="button" accessibilityLabel={price !== null ? plural('chat.make.buttonLabel', price) : t('chat.make.button')} disabled={!ready} containerStyle={styles.go} onPress={make} variant="secondary" size="md" label={price !== null ? plural('chat.make.buttonLabel', price) : t('chat.make.button')}>
                    {busy ? <ActivityIndicator color={styles.accentInkInk.color} /> : <Text tone={price !== null ? 'warning' : 'primary'}>{price !== null ? plural('chat.make.buttonPrice', price) : t('chat.make.button')}</Text>}
                </Button>
                <Button accessibilityRole="button" containerStyle={styles.close} onPress={onClose} variant="tertiary" size="md" label={(t('chat.make.close'))}><Text style={styles.closeText}>{t('chat.make.close')}</Text></Button>
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

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    accentInkInk: { color: p.textPrimary },
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingTop: 56, gap: 12 },
    title: { color: p.textPrimary },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    model: { minHeight: MIN_TARGET, padding: 12 },
    name: { color: p.textPrimary },
    note: { color: p.textTertiary },
    input: { minHeight: 96, maxHeight: 200 },
    error: { color: p.danger },
    go: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    close: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: p.accent },
}));
