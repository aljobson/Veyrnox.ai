import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { API_BASE, ApiError } from '../../../lib/api';
import { canDraw } from '../../../lib/drawOnImage';
import { createGenerationSubmit, generationMessage } from '../../../lib/generationSubmit';
import { CameraPanel } from '../../../components/CameraPanel';
import { CharacterPanel } from '../../../components/CharacterPanel';
import { CreateOptions, type OptionValues } from '../../../components/CreateOptions';
import { SourcePicker } from '../../../components/SourcePicker';
import { TemplateBanner } from '../../../components/TemplateBanner';
import { DEFAULT_CINEMA, buildCinemaPrompt, sanitizeCinema, type Cinema } from '../../../lib/cinemaCamera';
import { clearDraft, loadDraft, saveDraft } from '../../../lib/createDraftStore';
import { SAVED_DRAFT_VERSION, type CreateDraft, audioLengthInvalid, batchCost, freeLeftFor, hasAnyOption, imageCount, optionsFor, resolveAudio, resolveResolution, seedIsInvalid, settingsInputs, takesImageCount, voiceIsMissing } from '../../../lib/createOptions';
import { loadVibe } from '../../../lib/creatorProfileStore';
import { defaultAspect } from '../../../lib/creatorTaste';
import { nearestAspect, readTemplate } from '../../../lib/templateHandoff';
import { buildCharacterPrompt, sanitizePicks, type Picks } from '../../../lib/oddlingsBuilder';
import { useBalance } from '../../../lib/useBalance';
import { shortfall } from '../../../lib/lowBalance';
import { useFreeLeft } from '../../../lib/useFreeLeft';
import { estimateCredits, fetchCatalog, kindOf, promptRequired, textInput, type CatalogModel } from '../../../lib/media';
import { MIN_TARGET, selectedState } from '../../../lib/a11y';
import { toSourceAssets } from '../../../lib/librarySource';
import { portraitAsPickedFile, startOddlingId } from '../../../lib/oddlingsAnimate';
import type { PickedFile } from '../../../lib/sources';
import { SLOT_ORDER, missingRequired, slotsFor, toSourceKeys, type SlotName } from '../../../lib/sources';
import { MENU_ICONS } from '../../../lib/menuIcons';
import { colors, fonts, radius } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { creativeFeature } from '../../../lib/creativeFeatures';

const PLACEHOLDER: Record<string, string> = { topic: 'form.topicPlaceholder' };

// The host part of an address, or '' when it is not one.
function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

export default function CreateWithModel() {
    const { modelId, prompt: presetPrompt, duration: presetDuration, startOddling, tpl, tneeds, tratio, tposter, recipe } = useLocalSearchParams<{ modelId: string; prompt?: string; duration?: string; startOddling?: string; tpl?: string; tneeds?: string; tratio?: string; tposter?: string; recipe?: string }>();
    // A template also brings its name, picture, shape and what it needs; each is checked before it is used.
    const template = useMemo(() => readTemplate({ tpl, tneeds, tratio, tposter }, ['veyrnox.ai', hostOf(API_BASE)]), [tpl, tneeds, tratio, tposter]);
    const { api } = useAuth();
    const router = useRouter();
    const [model, setModel] = useState<CatalogModel | null>(null);
    // A template (ADR-0120) opens this form with its prompt and length filled in; both stay editable.
    const [prompt, setPrompt] = useState(typeof presetPrompt === 'string' ? presetPrompt.slice(0, 4000) : '');
    const [duration, setDuration] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    // Storage keys of the files already uploaded, by slot, and the slots still uploading.
    const [uploaded, setUploaded] = useState<Partial<Record<SlotName, string>>>({});
    // Library creations chosen as files, by slot (job ids). A slot has an upload or a Library file, never both.
    const [fromLibrary, setFromLibrary] = useState<Partial<Record<SlotName, string>>>({});
    const [sending, setSending] = useState<Partial<Record<SlotName, boolean>>>({});
    const [error, setError] = useState<string | null>(null);
    const [opts, setOpts] = useState<OptionValues>({ aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' });
    const [cameraOn, setCameraOn] = useState(false);
    const [cinema, setCinema] = useState<Cinema>(DEFAULT_CINEMA);
    const [characterOn, setCharacterOn] = useState(false);
    const [character, setCharacter] = useState<Picks>({});
    const [restored, setRestored] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    // "Animate this portrait" (Oddlings): the cast portrait goes into the image slot like any picked file.
    const startId = startOddlingId(startOddling);
    const [startFile, setStartFile] = useState<PickedFile | null>(null);
    const [startProblem, setStartProblem] = useState<string | null>(null);
    const freeMap = useFreeLeft();
    const balance = useBalance();
    // The newest unsaved draft, so leaving the screen (to buy credits, say) never loses the last words typed.
    const unsaved = useRef<CreateDraft | null>(null);
    // The same request keeps its keys (one per image), so a retry after a dropped connection is charged once.
    const pending = useRef(createGenerationSubmit());
    const draftReady = useRef(false);

    useEffect(() => {
        fetchCatalog()
            .then(async (all) => {
                const found = all.find((m) => m.id === modelId) ?? null;
                setModel(found);
                if (found && kindOf(found.modality) === 'video') {
                    const wanted = Number(presetDuration);
                    setDuration(found.durations.includes(wanted) ? wanted : (found.durations[0] ?? 5));
                }
                if (!found) setError(t('form.modelGone'));
                if (!found) return;
                const o = optionsFor(found);
                // Where the person said the result will land (the vibe check) picks the opening ratio; no answer keeps 16:9.
                const vibe = await loadVibe();
                // A template that has a shape of its own opens in the model's nearest one; otherwise the usual default.
                const aspect = nearestAspect(template?.ratio ?? null, o.aspects) ?? defaultAspect(o.aspects, vibe?.answers ?? null);
                const base: OptionValues = { aspect, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' };
                // A template brings its own words; only a form opened bare gets the unsent draft back.
                if (typeof presetPrompt === 'string') {
                    setOpts(base);
                    draftReady.current = true;
                    return;
                }
                loadDraft(found.id).then((d) => {
                    if (d) {
                        setPrompt(d.prompt);
                        if (d.duration !== null && found.durations.includes(d.duration)) setDuration(d.duration);
                        setOpts({ aspect: d.aspect && o.aspects.includes(d.aspect) ? d.aspect : base.aspect, count: imageCount(found, d.count), seed: d.seed, negative: d.negative, voice: d.voice ?? '', audioSeconds: d.audioSeconds ?? '' });
                        setCameraOn(d.cinemaOn === true);
                        setCinema(sanitizeCinema(d.cinema));
                        setCharacterOn(d.characterOn === true);
                        setCharacter(sanitizePicks(d.character));
                        setRestored(true);
                    } else setOpts(base);
                    draftReady.current = true;
                });
            })
            .catch(() => setError(t('form.modelLoad')));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelId, presetDuration]);

    const takesStartImage = !!model && slotsFor(model).some((s) => s.slot === 'image' && s.kind === 'image');
    useEffect(() => {
        if (!startId || !takesStartImage) return;
        let live = true;
        setStartProblem(null);
        portraitAsPickedFile(startId).then(
            (file) => { if (!live) return; if (file) setStartFile(file); else setStartProblem(t('oddlings.animate.loadFailed')); },
            () => { if (live) setStartProblem(t('oddlings.animate.loadFailed')); },
        );
        return () => { live = false; };
    }, [startId, takesStartImage]);

    // Words and settings are kept as they change, so a closed app or a call does not lose them.
    useEffect(() => {
        if (!model || !draftReady.current) return;
        const draft: CreateDraft = { v: SAVED_DRAFT_VERSION, modelId: model.id, prompt, duration, aspect: opts.aspect, count: opts.count, seed: opts.seed, negative: opts.negative, voice: opts.voice, audioSeconds: opts.audioSeconds, cinemaOn: cameraOn, cinema, characterOn, character };
        unsaved.current = draft;
        const id = setTimeout(() => {
            unsaved.current = null;
            saveDraft(draft).catch(() => undefined);
        }, 600);
        return () => clearTimeout(id);
    }, [model, prompt, duration, opts, cameraOn, cinema, characterOn, character]);

    const flushDraft = useCallback(async () => {
        const draft = unsaved.current;
        unsaved.current = null;
        if (draft) await saveDraft(draft).catch(() => undefined);
    }, []);

    // Closing the screen saves what was typed in the last moments too.
    useEffect(() => () => void flushDraft(), [flushDraft]);

    const discardDraft = useCallback(() => {
        setPrompt('');
        setOpts((o) => ({ ...o, seed: '', negative: '', count: 1, voice: '', audioSeconds: '' }));
        setCameraOn(false);
        setCharacterOn(false);
        setCharacter({});
        setRestored(false);
        clearDraft().catch(() => undefined);
    }, []);

    if (!model) {
        return <View style={styles.screen}>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
    }

    const isVideo = kindOf(model.modality) === 'video';
    const unit = estimateCredits(model, duration);
    const options = optionsFor(model);
    const n = imageCount(model, opts.count);
    const resolution = resolveResolution(model, options, opts.resolution);
    const audio = resolveAudio(model, options, opts.audio);
    const freeLeft = freeLeftFor(freeMap, model.id);
    // The first `freeLeft` images of a batch are free today; the server decides, this words the button.
    const price = batchCost(unit, n, freeLeft);
    // The camera words go into the prompt for image and video models; the price and the model do not change.
    const takesCharacter = kindOf(model.modality) === 'image' && textInput(model)?.key === 'prompt';
    const takesCamera = (kindOf(model.modality) === 'image' || isVideo) && textInput(model)?.key === 'prompt';
    // Character first, then the camera, as on the web. Both only rewrite the prompt.
    const withCharacter = takesCharacter && characterOn ? buildCharacterPrompt(prompt, character) : prompt.trim();
    const text = takesCamera && cameraOn ? buildCinemaPrompt(withCharacter, cinema) : withCharacter;
    const slots = slotsFor(model);
    const sources = toSourceKeys(uploaded);
    const assets = toSourceAssets(fromLibrary, SLOT_ORDER);
    const waiting = Object.values(sending).some(Boolean);
    const ready = !waiting && missingRequired(slots, { ...uploaded, ...fromLibrary }).length === 0 && (!promptRequired(model) || !!text) && !seedIsInvalid(opts.seed) && !voiceIsMissing(options, opts.voice) && !audioLengthInvalid(options, opts.audioSeconds);
    const text_ = textInput(model);
    const hasReference = sources.length > 0 || assets.length > 0 || !!startFile;
    const stageLine = template
        ? t('create.workspace.stageTemplate', { name: template.title })
        : hasReference
            ? t('create.workspace.stageReference')
            : t('create.workspace.stageEmpty');
    const modelLabel = creativeFeature(typeof recipe === 'string' ? recipe : undefined)?.title ?? model.name;

    async function generate() {
        if (!model || !ready || busy) return;
        const extra = settingsInputs(options, { seed: opts.seed, negative: opts.negative, aspect: opts.aspect, voice: opts.voice, audioSeconds: opts.audioSeconds, resolution, audio });
        setBusy(true);
        setError(null);
        setNote(null);
        let started = 0;
        let first: string | null = null;
        try {
            first = await pending.current.run(api, { modelId: model.id, prompt: text, durationSeconds: isVideo ? duration : null, confirmedCredits: unit, sources, assets, textKey: text_?.key, extraInputs: extra }, n, (count) => { started = count; });
            clearDraft().catch(() => undefined);
            if (n === 1 && first) router.replace({ pathname: '/job/[id]', params: { id: first } });
            else router.replace('/library');
        } catch (err) {
            setError(generationMessage(err));
            if (n > 1) setNote(t(err instanceof ApiError && err.code !== 'network' ? 'opt.started' : 'opt.startedUnknown', { started: String(started), count: String(n), next: String(started + 1) }));
        } finally {
            setBusy(false);
        }
    }

    const missing = shortfall(balance, price);
    const generateLabel = `${n > 1 ? t('opt.generateCount', { count: String(n) }) : t('slip.generate')}. ${costLine(price, n, freeLeft, unit)}`;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: t('label.Create') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <View style={styles.hero}>
                    <View style={styles.heroTop}>
                        <View style={styles.heroCopy}>
                            <Text style={styles.eyebrow}>{t('create.workspace.eyebrow')}</Text>
                            <Text style={styles.title} accessibilityRole="header">{t('label.Create')}</Text>
                        </View>
                        <View style={styles.savedPill} accessibilityLabel={t('create.workspace.savedHelp')}>
                            <View style={styles.savedDot} />
                            <Text style={styles.savedText}>{t('create.workspace.saved')}</Text>
                        </View>
                    </View>
                    <View style={styles.modelPill} accessibilityLabel={t('create.workspace.modelLabel', { name: modelLabel })}>
                        <Text style={styles.modelLive}>{t('create.livePrices')}</Text>
                        <Text style={styles.modelName}>{modelLabel}</Text>
                        <Text style={styles.modelKind}>{(kindOf(model.modality) ?? model.modality).toUpperCase()}</Text>
                    </View>
                </View>

                <View style={styles.stage} accessibilityLabel={stageLine}>
                    <View style={styles.stageIconBox}>
                        <Image source={MENU_ICONS.play} style={styles.stageIcon} tintColor={colors.accent} contentFit="contain" accessibilityElementsHidden />
                    </View>
                    <Text style={styles.stageTitle}>{stageLine}</Text>
                    <Text style={styles.stageBody}>{t('create.workspace.stageHelp')}</Text>
                </View>

                {template ? <TemplateBanner template={template} aspect={options.aspects.length ? opts.aspect : null} /> : null}
                {startId && takesStartImage ? <Text style={styles.consent} accessibilityLiveRegion="polite">{startProblem ?? t('oddlings.animate.startNote')}</Text> : null}
                {slots.length ? (
                    <View style={styles.section}>
                        <View style={styles.sectionTop}>
                            <Text style={styles.sectionLabel}>{t('create.workspace.references')}</Text>
                            <Text style={styles.sectionMeta}>{t('create.workspace.referencesMeta')}</Text>
                        </View>
                        {slots.map((s) => (
                            <SourcePicker
                                key={s.slot}
                                slot={s}
                                drawable={canDraw(model) && s.slot === 'image'}
                                api={api}
                                onChange={(key) => setUploaded((u) => ({ ...u, [s.slot]: key }))}
                                onLibrary={(jobId) => setFromLibrary((l) => ({ ...l, [s.slot]: jobId }))}
                                onBusy={(b) => setSending((x) => ({ ...x, [s.slot]: b }))}
                                initial={s.slot === 'image' ? startFile : null}
                                hint={s.slot === 'image' && template?.needs ? t('create.template.needs', { what: template.needs }) : undefined}
                            />
                        ))}
                    </View>
                ) : null}
                {text_ ? (
                    <View style={styles.section}>
                        <View style={styles.sectionTop}>
                            <Text style={styles.sectionLabel}>{text_.key === 'topic' ? t('form.topic').toUpperCase() : t('create.workspace.prompt')}</Text>
                            <Text style={styles.sectionMeta}>{prompt.length}/{text_.max}</Text>
                        </View>
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
                        <View style={styles.skillsRow}>
                            <Text style={styles.skillsIntro}>{t('create.workspace.skills')}</Text>
                            <Pressable accessibilityRole="link" style={styles.skillLink} onPress={() => router.push('/chat/skills')}>
                                <Text style={styles.skillLinkText}>{t('create.workspace.promptWriter')}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="link" style={styles.skillLink} onPress={() => router.push('/chat/skills')}>
                                <Text style={styles.skillLinkText}>{t('create.workspace.fixPrompt')}</Text>
                            </Pressable>
                        </View>
                    </View>
                ) : null}
                {restored ? (
                    <View style={styles.restored} accessibilityLiveRegion="polite">
                        <Text style={styles.restoredText}>{t('opt.draftRestored')}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('opt.draftClear')} style={styles.clear} onPress={discardDraft}>
                            <Text style={styles.clearText}>{t('opt.draftClear')}</Text>
                        </Pressable>
                    </View>
                ) : null}
                {sources.length || assets.length ? <Text style={styles.consent}>{t('form.consent')}</Text> : null}
                {((isVideo && model.durations.length > 1) || hasAnyOption(options) || takesImageCount(model) || takesCharacter || takesCamera) ? (
                    <View style={styles.settingsSection}>
                        <View style={styles.sectionTop}>
                            <Text style={styles.sectionLabel}>{t('create.workspace.settings')}</Text>
                            <Text style={styles.sectionMeta}>{t('create.workspace.settingsMeta')}</Text>
                        </View>
                        {isVideo && model.durations.length > 1 ? (
                            <View style={styles.chips}>
                                {model.durations.map((d) => (
                                    <Pressable key={d} accessibilityRole="button" accessibilityLabel={plural('form.seconds', d)} accessibilityState={selectedState(duration === d)} style={[styles.chip, duration === d && styles.chipOn]} onPress={() => setDuration(d)}>
                                        <Text style={[styles.chipText, duration === d && styles.chipTextOn]}>{d}s</Text>
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}
                        {hasAnyOption(options) || takesImageCount(model) ? <CreateOptions options={options} values={opts} showCount={takesImageCount(model)} resolution={resolution} audio={audio} outputPrice={plural('opt.outputPriceSame', unit)} onChange={setOpts} /> : null}
                        {takesCharacter ? <CharacterPanel on={characterOn} picks={character} onToggle={setCharacterOn} onChange={setCharacter} /> : null}
                        {takesCamera ? <CameraPanel on={cameraOn} value={cinema} onToggle={setCameraOn} onChange={setCinema} /> : null}
                    </View>
                ) : null}
                {missing > 0 ? (
                    <View style={styles.short} accessibilityLiveRegion="polite">
                        <Text style={styles.shortText}>{plural('create.short', missing, { have: String(balance ?? 0), need: String(price) })}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('lowBalance.buy')} style={styles.shortBuy} onPress={async () => { await flushDraft(); router.push('/credits'); }}>
                            <Text style={styles.shortBuyText}>{t('lowBalance.buy')}</Text>
                        </Pressable>
                    </View>
                ) : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {note ? <Text style={styles.consent}>{note}</Text> : null}
                <View style={styles.costCard}>
                    <View style={styles.costTop}>
                        <View>
                            <Text style={styles.sectionLabel}>{t('create.workspace.total')}</Text>
                            <Text style={styles.cost} accessibilityLiveRegion="polite">{price === 0 ? t('opt.costFree') : t('create.workspace.cost', { credits: String(price) })}</Text>
                        </View>
                        <Text style={styles.balance}>{t('create.workspace.balance', { credits: balance === null ? '—' : String(balance) })}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={generateLabel} accessibilityState={{ busy, disabled: !ready || busy || missing > 0 }} disabled={!ready || busy || missing > 0} style={[styles.button, (!ready || busy || missing > 0) && styles.off]} onPress={generate}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{price === 0 ? t('create.workspace.generateFree') : t('create.workspace.generate', { credits: String(price) })}</Text>}
                    </Pressable>
                    <Text style={styles.refund}>{t('create.workspace.refund')}</Text>
                    <Text style={styles.terms}>
                        {t('create.workspace.terms')}{' '}
                        <Text accessibilityRole="link" style={styles.inlineLink} onPress={() => void WebBrowser.openBrowserAsync(`${API_BASE}/legal/terms`)}>{t('create.workspace.termsLink')}</Text>
                    </Text>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// What Generate will cost, said before it is pressed. Free runs left today are applied first.
function costLine(price: number, n: number, freeLeft: number, unit: number): string {
    if (price === 0) return t('opt.costFree');
    if (n > 1 && freeLeft > 0) return plural('opt.costsPartial', price, { free: String(Math.min(freeLeft, n)), images: String(n) });
    if (n > 1) return plural('opt.costsBatch', price, { images: String(n) });
    return plural('form.costs', unit);
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, paddingBottom: 48, gap: 14 },
    hero: { gap: 12, marginBottom: 2 },
    heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    heroCopy: { flex: 1, gap: 4 },
    eyebrow: { color: colors.muted, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.6 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 36, lineHeight: 39, letterSpacing: -1.1 },
    savedPill: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    savedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
    savedText: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    modelPill: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    modelLive: { color: colors.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    modelName: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
    modelKind: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    stage: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: 24, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    stageIconBox: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
    stageIcon: { width: 30, height: 30 },
    stageTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '700', textAlign: 'center', marginTop: 16 },
    stageBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, maxWidth: 300 },
    section: { gap: 9 },
    settingsSection: { gap: 12, marginTop: 2 },
    sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionLabel: { color: colors.muted, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.35 },
    sectionMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
    topic: { minHeight: 90 },
    prompt: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.lg, padding: 14, fontSize: 16, lineHeight: 23, minHeight: 126, textAlignVertical: 'top' },
    skillsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
    skillsIntro: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    skillLink: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 7 },
    skillLinkText: { color: colors.accent, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    short: { backgroundColor: colors.surface, borderColor: colors.money, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
    shortText: { color: colors.body, fontSize: 15, lineHeight: 22 },
    shortBuy: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    shortBuyText: { color: colors.money, fontSize: 16, fontWeight: '700' },
    restored: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingLeft: 14 },
    restoredText: { color: colors.body, flexShrink: 1 },
    clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
    clearText: { color: colors.accent, fontWeight: '600' },
    consent: { color: colors.muted, fontSize: 12 },
    costCard: { gap: 11, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    costTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    cost: { color: colors.money, fontFamily: fonts.displayHeavy, fontSize: 30, lineHeight: 34, marginTop: 4 },
    balance: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    button: { minHeight: MIN_TARGET, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    refund: { color: colors.accent, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1, textAlign: 'center' },
    terms: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
    inlineLink: { color: colors.accent, textDecorationLine: 'underline', fontWeight: '700' },
    error: { color: colors.danger },
});
