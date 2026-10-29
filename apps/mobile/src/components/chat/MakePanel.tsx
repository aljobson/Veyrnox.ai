import { rawText } from '../../lib/i18n/translate';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { subscribeCacheUser } from '../../lib/appCache';
import { MIN_TARGET } from '../../lib/a11y';
import { byPrice, chatMediaModels, makePrice, makeReady, MAX_MEDIA_PROMPT, MEDIA_KINDS, supportedDuration } from '../../lib/chatMedia';
import { batchCost, freeLeftFor, imageCount, optionsFor, resolveAudio, resolveResolution, settingsInputs, takesImageCount } from '../../lib/createOptions';
import { plural, t } from '../../lib/i18n';
import { shortfall } from '../../lib/lowBalance';
import { estimateCredits, fetchCatalog, kindOf, textInput, type CatalogModel, type Kind } from '../../lib/media';
import { replaceSlotReferences, type GenerationReference, type SlotName } from '../../lib/sources';
import { useBalance } from '../../lib/useBalance';
import { useMakePanelState } from '../../lib/useMakePanelState';
import { CreateOptions, type OptionValues } from '../CreateOptions';
import { Text, TextField, Button, Card, Chip, themedStyles, useThemedStyles } from '../ui';
import { MakeResult } from './MakeResult';
import { MakeSources } from './MakeSources';

interface Props {
    readonly visible: boolean;
    readonly initialPrompt?: string;
    readonly initialKind?: Kind;
    readonly onClose: () => void;
    readonly onJobStarted?: (jobId: string, model: CatalogModel) => void;
    readonly resultNote?: string;
}
const defaults = (model?: CatalogModel | null): OptionValues => ({
    aspect: model ? optionsFor(model).aspects[0] ?? null : null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '',
});

export function MakePanel({ visible, initialPrompt = '', initialKind = 'image', onClose, onJobStarted, resultNote }: Props) {
    const styles = useThemedStyles(sheets);
    const reducedMotion = useReducedMotion();
    const { api } = useAuth();
    const router = useRouter();
    const balance = useBalance();
    const state = useMakePanelState(api, visible);
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [kind, setKind] = useState<Kind>('image');
    const [modelId, setModelId] = useState<string | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [prompt, setPrompt] = useState(initialPrompt);
    const [opts, setOpts] = useState<OptionValues>(defaults());
    const [references, setReferences] = useState<readonly GenerationReference[]>([]);
    const [rights, setRights] = useState(false);
    const [sending, setSending] = useState<Partial<Record<SlotName, boolean>>>({});
    const epoch = useRef(0);
    const [sourceEpoch, setSourceEpoch] = useState(0);
    const models = catalog ? byPrice(chatMediaModels(catalog, kind)) : [];
    const model = models.find(m => m.id === modelId) ?? models[0] ?? null;

    function clearSources() {
        setSourceEpoch(++epoch.current); setReferences([]); setRights(false); setSending({});
    }
    function select(next: CatalogModel | null, nextKind = kind) {
        if (state.submitting) return;
        setKind(nextKind); setModelId(next?.id ?? null); setDuration(null); setOpts(defaults(next)); clearSources();
    }
    useEffect(() => {
        if (!visible || catalog) return;
        let live = true;
        fetchCatalog().then(value => { if (live) setCatalog(value); }, () => { if (live) setLoadError(t('chat.make.loadFailed')); });
        return () => { live = false; };
    }, [visible, catalog]);
    useEffect(() => {
        if (!visible) return;
        setKind(initialKind); setModelId(null); setDuration(null); setPrompt(initialPrompt); setLoadError(null);
        setOpts(defaults(catalog ? byPrice(chatMediaModels(catalog, initialKind))[0] : null)); clearSources();
    }, [visible, initialPrompt, initialKind]);
    useEffect(() => { setOpts(defaults(model)); }, [model?.id]);
    useEffect(() => subscribeCacheUser(() => { clearSources(); setPrompt(''); setOpts(defaults()); }), []);
    useEffect(() => () => { epoch.current++; }, []);

    const length = model ? supportedDuration(model, duration) : null;
    const options = model ? optionsFor(model) : null;
    const unit = model ? estimateCredits(model, length) : 0;
    const n = model ? imageCount(model, opts.count) : 1;
    const resolution = model && options ? resolveResolution(model, options, opts.resolution) : null;
    const audio = model && options ? resolveAudio(model, options, opts.audio) : null;
    const promptLimit = model ? textInput(model)?.max ?? MAX_MEDIA_PROMPT : MAX_MEDIA_PROMPT;
    const unboundedPrompt = prompt.trim();
    const promptTooLong = unboundedPrompt.length > promptLimit;
    const text = unboundedPrompt;
    const request = model && options ? {
        modelId: model.id, prompt: text, durationSeconds: kindOf(model.modality) === 'video' ? length : null,
        confirmedCredits: unit, references, sourceRights: references.length ? rights : undefined, textKey: 'prompt',
        extraInputs: settingsInputs(options, { ...opts, resolution, audio }),
    } : null;
    const retry = state.retry?.signature === JSON.stringify({ ...request, count: n }) ? state.retry : null;
    const price = model ? batchCost(unit, n - (retry?.started ?? 0), freeLeftFor(state.freeMap, model.id)) : null;
    const missing = retry?.blocked ? 0 : shortfall(balance, price ?? 0);
    const waiting = Object.values(sending).some(Boolean);
    const ready = !!model && !promptTooLong && makeReady(model, text, references, rights, waiting, opts) && !state.submitting && missing === 0;
    const close = () => { epoch.current++; state.close(); onClose(); };
    const buy = () => { close(); router.push('/credits'); };
    const label = price === null ? t('chat.make.button') : price === 0 ? t('opt.costFree') : plural('chat.make.buttonLabel', price);

    return (
        <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={close}>
            <ScrollView style={styles.screen} onAccessibilityEscape={close} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text variant="title2" accessibilityRole="header">{t('chat.make.title')}</Text>
                <MakeResult jobs={state.jobs} count={state.count} canMakeAnother={!state.submitting && !state.retry?.blocked}
                    onOpen={id => { close(); router.push({ pathname: '/job/[id]', params: { id } }); }}
                    onLibrary={onJobStarted ? undefined : () => { close(); router.push('/library'); }}
                    onMakeAnother={() => { if (state.makeAnother()) clearSources(); }} />
                {resultNote ? <Text variant="footnote">{resultNote}</Text> : null}
                <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.kind')}>
                    {MEDIA_KINDS.map(k => <Chip key={k} accessibilityRole="radio" disabled={state.submitting}
                        accessibilityState={{ selected: kind === k, disabled: state.submitting }}
                        onPress={() => select(catalog ? byPrice(chatMediaModels(catalog, k))[0] ?? null : null, k)} label={t(`chat.make.kind.${k}`)} selected={kind === k} />)}
                </View>
                {catalog === null && !loadError ? <ActivityIndicator color={styles.accentInk.color} /> : null}
                {catalog && models.length === 0 ? <Text variant="footnote" tone="tertiary">{t('chat.make.none')}</Text> : null}
                <ScrollView horizontal contentContainerStyle={styles.models} keyboardShouldPersistTaps="handled" accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.title')}>
                    {models.map(m => <Card key={m.id} accessibilityRole="radio" disabled={state.submitting}
                        accessibilityLabel={rawText(`${m.name}, ${plural('chat.make.from', makePrice(m, null))}`)}
                        accessibilityState={{ selected: m.id === model?.id, disabled: state.submitting }} style={styles.model}
                        onPress={() => select(m)} selected={m.id === model?.id}>
                        <Text>{m.name}</Text><Text variant="footnote" tone="warning">{plural('chat.make.from', makePrice(m, null))}</Text>
                    </Card>)}
                </ScrollView>
                {model && kindOf(model.modality) === 'video' && model.durations.length > 1 ? (
                    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.make.length')}>
                        {model.durations.map(d => <Chip key={d} accessibilityRole="radio" accessibilityState={{ selected: length === d }} onPress={() => setDuration(d)} label={t('chat.make.seconds', { n: String(d) })} selected={length === d} />)}
                    </View>
                ) : null}
                {model && options ? <CreateOptions options={options} values={opts} showCount={takesImageCount(model)} resolution={resolution} audio={audio} outputPrice={plural('opt.outputPriceSame', unit)} onChange={setOpts} /> : null}
                {model ? <MakeSources key={`${model.id}:${sourceEpoch}`} api={api} model={model} references={references} rights={rights} waiting={waiting}
                    onRights={setRights} onReferences={(slot, files) => {
                        if (sourceEpoch !== epoch.current) return;
                        setRights(false); setReferences(all => replaceSlotReferences(all, slot, files));
                    }} onBusy={(slot, busy) => { if (sourceEpoch === epoch.current) setSending(all => ({ ...all, [slot]: busy })); }} /> : null}
                <TextField style={styles.input} value={prompt} onChangeText={setPrompt} multiline maxLength={promptLimit} placeholder={t('chat.make.placeholder')} accessibilityLabel={t('chat.make.promptLabel')} />
                {promptTooLong ? <Text variant="caption" tone="warning" accessibilityLiveRegion="polite">
                    {t('public.TemplateRecipe.promptTooLong', { count: String(unboundedPrompt.length), max: String(promptLimit) })}
                </Text> : null}
                {balance !== null ? <Text variant="caption" tone="secondary">{t('create.workspace.balance', { credits: String(balance) })}</Text> : null}
                {missing > 0 ? <Text accessibilityLiveRegion="polite">{plural('create.short', missing, { have: String(balance ?? 0), need: String(price) })}</Text> : null}
                {state.error || loadError ? <Text tone="danger" accessibilityRole="alert">{state.error ?? loadError}</Text> : null}
                {state.note ? <Text variant="caption" accessibilityLiveRegion="polite">{state.note}</Text> : null}
                {missing > 0 || state.lowBalance ? <Button label={t('lowBalance.buy')} variant="secondary" onPress={buy} /> : null}
                <Button accessibilityRole="button" accessibilityLabel={rawText(label)} disabled={!ready} containerStyle={styles.go}
                    onPress={() => { if (ready && request && model) void state.run(request, n, onJobStarted ? id => onJobStarted(id, model) : undefined); }} variant="secondary" label={label}>
                    {state.submitting ? <ActivityIndicator color={styles.ink.color} /> : <Text tone={price !== null ? 'warning' : 'primary'}>{price === null ? t('chat.make.button') : price === 0 ? t('create.workspace.generateFree') : plural('chat.make.buttonPrice', price)}</Text>}
                </Button>
                <Button variant="tertiary" onPress={close} label={t('chat.make.close')} />
            </ScrollView>
        </Modal>
    );
}
const sheets = themedStyles(p => ({
    accentInk: { color: p.accent }, ink: { color: p.textPrimary },
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingTop: 56, gap: 12 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    models: { gap: 8 }, model: { minHeight: MIN_TARGET, padding: 12 },
    input: { minHeight: 96, maxHeight: 200 },
    go: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
}));
