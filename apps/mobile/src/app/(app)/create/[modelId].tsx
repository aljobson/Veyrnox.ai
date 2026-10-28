import { Image } from 'expo-image';
import { CreateResult, type ResultBatch } from '../../../components/create/CreateResult';
import { refreshBalance } from '../../../lib/createResult';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import type { SubmitRequest } from '../../../lib/generationSubmit';
import { english } from '../../../lib/i18n/binding';
import { KeyboardFormScrollView } from '../../../components/KeyboardFormScrollView';
import { KeyboardScreen } from '../../../components/KeyboardScreen';
import { FormHeader } from '../../../components/create/FormHeader';
import { SectionLabel } from '../../../components/create/SectionLabel';
import { SourceDurationCard } from '../../../components/create/SourceDurationCard';
import { Text, TextField, Button, Card, Chip, Checkbox, themedStyles, useThemedStyles } from '../../../components/ui';

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { API_BASE, ApiError } from '../../../lib/api';
import { canDraw } from '../../../lib/drawOnImage';
import { createGenerationSubmit, generationMessage } from '../../../lib/generationSubmit';
import { CameraPanel } from '../../../components/CameraPanel';
import { CharacterPanel } from '../../../components/CharacterPanel';
import { CreateOptions, type OptionValues } from '../../../components/CreateOptions';
import { AttachFromDevice } from '../../../components/AttachFromDevice';
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
import { useFreeLeftState } from '../../../lib/useFreeLeft';
import { estimateCredits, fetchCatalog, kindOf, promptRequired, textInput, type CatalogModel } from '../../../lib/media';
import { MIN_TARGET, selectedState } from '../../../lib/a11y';
import { portraitAsPickedFile, startOddlingId } from '../../../lib/oddlingsAnimate';
import type { PickedFile } from '../../../lib/sources';
import { legacyReferences, replaceSlotReferences, slotsFor, type GenerationReference, type SlotName } from '../../../lib/sources';

import { ds } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { creativeFeature } from '../../../lib/creativeFeatures';
import { consumeCreativeSourceHandoff, readCreativeSourceHandoff } from '../../../lib/creativeSourceHandoff';

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
    const styles = useThemedStyles(sheets);
    const { modelId, prompt: presetPrompt, duration: presetDuration, aspect: presetAspect, startOddling, tpl, tid, tneeds, tratio, tposter, recipe, sourceHandoff } = useLocalSearchParams<{ modelId: string; prompt?: string; duration?: string; aspect?: string; startOddling?: string; tpl?: string; tid?: string; tneeds?: string; tratio?: string; tposter?: string; recipe?: string; sourceHandoff?: string }>();
    // A template also brings its name, picture, shape and what it needs; each is checked before it is used.
    const template = useMemo(() => readTemplate({ tpl, tid, tneeds, tratio, tposter }, ['veyrnox.ai', hostOf(API_BASE)]), [tpl, tid, tneeds, tratio, tposter]);
    const handedSources = useMemo(() => readCreativeSourceHandoff(typeof sourceHandoff === 'string' ? sourceHandoff : undefined, typeof recipe === 'string' ? recipe : undefined, modelId), [modelId, recipe, sourceHandoff]);
    const { api } = useAuth();
    const router = useRouter();
    const [model, setModel] = useState<CatalogModel | null>(null);
    // A template (ADR-0120) opens this form with its prompt and length filled in; both stay editable.
    const [prompt, setPrompt] = useState(typeof presetPrompt === 'string' ? presetPrompt.slice(0, 4000) : '');
    const [duration, setDuration] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    // Storage keys of the files already uploaded, by slot, and the slots still uploading.
    const [references, setReferences] = useState<readonly GenerationReference[]>(() => handedSources?.references ?? legacyReferences(handedSources?.uploaded ?? {}, handedSources?.fromLibrary ?? {}));
    // Pre-ticked only when the handing screen showed the rights statement and the person ticked it (Attach from device does not).
    const [sourceRights, setSourceRights] = useState(handedSources?.rightsConfirmed === true);
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
    const [refreshKey, setRefreshKey] = useState(0);
    const { left: freeMap, loading: freeLoading } = useFreeLeftState(refreshKey);
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [results, setResults] = useState<ResultBatch | null>(null);
    const [complete, setComplete] = useState(false);
    const [confirmed, setConfirmed] = useState(0);
    const batch = useRef(0);
    const balanceSeq = useRef(0);
    const retry = useRef<{ signature: string; request: SubmitRequest; count: number; unit: number } | null>(null);
    const balance = useBalance();
    // The newest unsaved draft, so leaving the screen (to buy credits, say) never loses the last words typed.
    const unsaved = useRef<CreateDraft | null>(null);
    // The same request keeps its keys (one per image), so a retry after a dropped connection is charged once.
    const pending = useRef(createGenerationSubmit());
    const draftReady = useRef(false);
    useEffect(() => {
        const clear = () => { void Image.clearMemoryCache?.().catch(() => {}); batch.current++; balanceSeq.current++; pending.current.reset(); retry.current = null; setResults(null); setConfirmed(0); setComplete(false); setBusy(false); };
        const unsubscribe = subscribeCacheUser(clear);
        return () => { unsubscribe(); batch.current++; balanceSeq.current++; };
    }, []);
    function newGeneration() {
        if (busy) return;
        batch.current++; balanceSeq.current++; pending.current.reset(); retry.current = null;
        setResults(null); setConfirmed(0); setComplete(false); setError(null); setNote(null);
    }

    useEffect(() => {
        consumeCreativeSourceHandoff(typeof sourceHandoff === 'string' ? sourceHandoff : undefined, typeof recipe === 'string' ? recipe : undefined, modelId);
    }, [modelId, recipe, sourceHandoff]);

    useEffect(() => {
        fetchCatalog()
            .then(async (all) => {
                setCatalog(all);
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
                const guidedAspect = handedSources?.aspect;
                const handedAspect = presetAspect && o.aspects.includes(presetAspect) ? presetAspect : null;
                const aspect = handedAspect ?? (guidedAspect && o.aspects.includes(guidedAspect) ? guidedAspect : null) ?? nearestAspect(template?.ratio ?? null, o.aspects) ?? defaultAspect(o.aspects, vibe?.answers ?? null);
                const base: OptionValues = { aspect, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' };
                // A template brings its own words; only a form opened bare gets the unsent draft back.
                if (typeof presetPrompt === 'string' || handedSources?.picks) {
                    if (handedSources?.picks) {
                        const picks = sanitizePicks(handedSources.picks);
                        if (kindOf(found.modality) === 'image' && textInput(found)?.key === 'prompt') {
                            setCharacter(picks);
                            setCharacterOn(true);
                        } else setPrompt(buildCharacterPrompt(typeof presetPrompt === 'string' ? presetPrompt : '', picks));
                    }
                    setOpts(base);
                    draftReady.current = true;
                    return;
                }
                loadDraft(found.id).then((d) => {
                    if (d) {
                        setPrompt(d.prompt);
                        if (d.duration !== null && found.durations.includes(d.duration)) setDuration(d.duration);
                        setOpts({ aspect: handedAspect ?? (d.aspect && o.aspects.includes(d.aspect) ? d.aspect : base.aspect), count: imageCount(found, d.count), seed: d.seed, negative: d.negative, voice: d.voice ?? '', audioSeconds: d.audioSeconds ?? '' });
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
    }, [modelId, presetDuration, presetAspect, handedSources, presetPrompt, template]);

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
        return <View style={styles.screen}>{error ? <Text variant="body" tone="danger" style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : <ActivityIndicator color={styles.accentInk.color} />}</View>;
    }

    const isVideo = kindOf(model.modality) === 'video';
    const unit = estimateCredits(model, duration);
    const options = optionsFor(model);
    const n = imageCount(model, opts.count);
    const resolution = resolveResolution(model, options, opts.resolution);
    const audio = resolveAudio(model, options, opts.audio);
    const freeLeft = freeLoading ? 0 : freeLeftFor(freeMap, model.id);
    // The camera words go into the prompt for image and video models; the price and the model do not change.
    const takesCharacter = kindOf(model.modality) === 'image' && textInput(model)?.key === 'prompt';
    const takesCamera = (kindOf(model.modality) === 'image' || isVideo) && textInput(model)?.key === 'prompt';
    // Character first, then the camera, as on the web. Both only rewrite the prompt.
    const withCharacter = takesCharacter && characterOn ? buildCharacterPrompt(prompt, character) : prompt.trim();
    const text = takesCamera && cameraOn ? buildCinemaPrompt(withCharacter, cinema) : withCharacter;
    const slots = slotsFor(model);
    const waiting = Object.values(sending).some(Boolean);
    const hasReference = references.length > 0 || !!startFile;
    const ready = !waiting && (!hasReference || sourceRights) && slots.every(slot => (!slot.required || references.some(ref => ref.slot === slot.slot)) && references.filter(ref => ref.slot === slot.slot).length <= (slot.maxFiles ?? 1)) && (!promptRequired(model) || !!text) && !seedIsInvalid(opts.seed) && !voiceIsMissing(options, opts.voice) && !audioLengthInvalid(options, opts.audioSeconds);
    const text_ = textInput(model);
    const request: SubmitRequest = { analyticsKind: kindOf(model.modality), modelId: model.id, prompt: text, durationSeconds: isVideo ? duration : null, confirmedCredits: unit, references, sourceRights: hasReference ? sourceRights : undefined, textKey: text_?.key, extraInputs: settingsInputs(options, { seed: opts.seed, negative: opts.negative, aspect: opts.aspect, voice: opts.voice, audioSeconds: opts.audioSeconds, resolution, audio }), preset: template?.id ?? undefined };
    const signature = JSON.stringify({ ...request, count: n });
    const matchingRetry = retry.current?.signature === signature ? retry.current : null;
    // Only an unchanged request retains its confirmed items and retry price.
    const price = batchCost(unit, Math.max(0, n - (!complete && matchingRetry ? confirmed : 0)), freeLeft);
    const stageLine = template
        ? t('create.workspace.stageTemplate', { name: template.title })
        : hasReference
            ? t('create.workspace.stageReference')
            : t('create.workspace.stageEmpty');
    const modelLabel = creativeFeature(typeof recipe === 'string' ? recipe : undefined)?.title ?? model.name;

    async function generate() {
        if (!model || (!ready && !matchingRetry) || busy || freeLoading) return;
        if (retry.current && !matchingRetry) newGeneration();
        const run = matchingRetry ?? { signature, request, count: n, unit };
        retry.current = run;
        const generation = batch.current;
        const owner = getCacheUser();
        const current = () => generation === batch.current && owner === getCacheUser();
        setBusy(true); setError(null); setNote(null);
        let started = 0;
        let firstId: string | null = null;
        try {
            await pending.current.run(api, run.request, run.count, count => { started = count; if (current()) setConfirmed(previous => Math.max(previous, count)); }, id => {
                firstId = firstId ?? id;
                if (!current()) return;
                setResults(previous => previous ? { ...previous, ids: previous.ids.includes(id) ? previous.ids : [...previous.ids, id] } : { ids: [id], modelId: model.id, kind: kindOf(model.modality), aspect: opts.aspect, duration, count: run.count });
            });
            if (!current()) return;
            clearDraft().catch(() => undefined);
            // A single Faceless Reel clip still opens its job page, where the sound step is offered (ADR-0279).
            const facelessSound = handedSources?.recipe === 'faceless-reel' && handedSources.followup === 'generated-sound' && model.id === 'wan-2.5-kie' && duration !== null && duration <= 8;
            if (run.count === 1 && firstId && facelessSound) router.replace({ pathname: '/job/[id]', params: { id: firstId, followup: 'faceless-sound' } });
            else setComplete(true);
        } catch (err) {
            if (!current()) return;
            setError(generationMessage(err));
            if (run.count > 1) setNote(t(err instanceof ApiError && err.code !== 'network' ? 'opt.started' : 'opt.startedUnknown', { started: String(started), count: String(run.count), next: String(started + 1) }));
        } finally {
            if (current()) {
                setBusy(false); setRefreshKey(key => key + 1);
                void refreshBalance(api, owner, current, balanceSeq);
            }
        }
    }
    const generation = batch.current;
    const owner = getCacheUser();
    const resultSettled = () => { if (generation === batch.current) void refreshBalance(api, owner, () => generation === batch.current, balanceSeq); };

    const missing = complete ? 0 : shortfall(balance, price);
    const disabled = busy || (!complete && (freeLoading || (!ready && !matchingRetry) || missing > 0));
    const generateLabel = `${n > 1 ? t('opt.generateCount', { count: String(n) }) : t('slip.generate')}. ${costLine(price, n, freeLeft, unit)}`;

    return (
        <KeyboardScreen style={styles.screen}>
            <Stack.Screen options={{ title: t('label.Create') }} />
            <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <FormHeader modelLabel={modelLabel} modality={kindOf(model.modality) ?? model.modality} stageLine={stageLine} stage={results ? <CreateResult api={api} batch={results} catalog={catalog} onTerminal={resultSettled} /> : undefined} />

                {template ? <TemplateBanner template={template} aspect={options.aspects.length ? opts.aspect : null} /> : null}
                {startId && takesStartImage ? <Text variant="caption" tone="tertiary" style={styles.consent} accessibilityLiveRegion="polite">{startProblem ?? t('oddlings.animate.startNote')}</Text> : null}
                {slots.length ? (
                    <View style={styles.section}>
                        <View style={styles.sectionTop}>
                            <SectionLabel style={styles.sectionLabel}>{t('create.workspace.references')}</SectionLabel>
                            <SectionLabel style={styles.sectionMeta}>{t('create.workspace.referencesMeta')}</SectionLabel>
                        </View>
                        {slots.map((s) => (
                            <SourcePicker
                                key={s.slot}
                                slot={s}
                                drawable={canDraw(model) && s.slot === 'image'}
                                api={api}
                                references={references.filter(ref => ref.slot === s.slot)}
                                onReferences={files => { setSourceRights(false); setReferences(all => replaceSlotReferences(all, s.slot, files)); }}
                                onChange={() => {}}
                                onLibrary={() => {}}
                                onBusy={(b) => setSending((x) => ({ ...x, [s.slot]: b }))}
                                initial={s.slot === 'image' ? startFile : null}
                                initialReady={references.some(ref => ref.slot === s.slot)}
                                hint={s.slot === 'image' && template?.needs ? t('create.template.needs', { what: template.needs }) : undefined}
                            />
                        ))}
                    </View>
                ) : null}
                <View style={styles.section}><AttachFromDevice api={api} current={model} /></View>
                {text_ ? (
                    <View style={styles.section}>
                        <View style={styles.sectionTop}>
                            <SectionLabel style={styles.sectionLabel}>{text_.key === 'topic' ? t('form.topic') : t('create.workspace.prompt')}</SectionLabel>
                            <Text variant="footnote" tone="secondary">{prompt.length}/{text_.max}</Text>
                        </View>
                        <TextField
                            style={[styles.prompt, text_.key === 'topic' && styles.topic]}
                            value={prompt}
                            onChangeText={setPrompt}
                            placeholder={t(PLACEHOLDER[text_.key] ?? (promptRequired(model) ? 'form.describeCreate' : 'form.describeChange'))}
                            placeholderTextColor={styles.mutedInk.color}
                            accessibilityLabel={text_.key === 'topic' ? t('form.topic') : t('mobile.prompt')}
                            multiline
                            maxLength={text_.max}
                        />
                        <View style={styles.skillsRow}>
                            <Text variant="caption" tone="tertiary" style={styles.skillsIntro}>{t('create.workspace.skills')}</Text>
                            <Button variant="tertiary" accessibilityRole="link" onPress={() => router.push('/chat/skills')} label={t('create.workspace.promptWriter')} />
                            <Button variant="tertiary" accessibilityRole="link" onPress={() => router.push('/chat/skills')} label={t('create.workspace.fixPrompt')} />
                        </View>
                    </View>
                ) : null}
                {restored ? (
                    <View style={styles.restored}>
                        <Text variant="body" tone="secondary" accessibilityLiveRegion="polite" style={styles.restoredText}>{t('opt.draftRestored')}</Text>
                        <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={t('opt.draftClear')} onPress={discardDraft} label={t('opt.draftClear')} />
                    </View>
                ) : null}
                {references.length ? <View style={styles.rightsBox}><Checkbox checked={sourceRights} accessibilityRole="checkbox" accessibilityLanguage="en" accessibilityLabel={english('form.sourceRights')} accessibilityState={{ checked: sourceRights, disabled: waiting }} disabled={waiting} onChange={() => setSourceRights((value) => !value)} style={styles.rightsControl}><Text variant="caption" tone="secondary" style={styles.rightsText}>{english('form.sourceRights')}</Text></Checkbox><Text accessibilityLanguage="en" variant="caption" tone="tertiary" style={styles.consent}>{english('form.consent')}</Text></View> : null}
                {((isVideo && model.durations.length > 1) || hasAnyOption(options) || takesImageCount(model) || takesCharacter || takesCamera) ? (
                    <View style={styles.settingsSection}>
                        <View style={styles.sectionTop}>
                            <SectionLabel style={styles.sectionLabel}>{t('create.workspace.settings')}</SectionLabel>
                            <SectionLabel style={styles.sectionMeta}>{t('create.workspace.settingsMeta')}</SectionLabel>
                        </View>
                        {isVideo && model.durations.length > 1 ? (
                            <View style={styles.chips}>
                                {model.durations.map((d) => (
                                    <Chip key={d} label={t('create.s', { value1: d })} accessibilityRole="button" accessibilityLabel={plural('form.seconds', d)} accessibilityState={selectedState(duration === d)} selected={duration === d} onPress={() => setDuration(d)} />
                                ))}
                            </View>
                        ) : null}
                        {hasAnyOption(options) || takesImageCount(model) ? <CreateOptions options={options} values={opts} showCount={takesImageCount(model)} resolution={resolution} audio={audio} outputPrice={plural('opt.outputPriceSame', unit)} onChange={setOpts} /> : null}
                        {takesCharacter ? <CharacterPanel on={characterOn} picks={character} onToggle={setCharacterOn} onChange={setCharacter} /> : null}
                        {takesCamera ? <CameraPanel on={cameraOn} value={cinema} onToggle={setCameraOn} onChange={setCinema} /> : null}
                    </View>
                ) : null}
                <SourceDurationCard model={model} />
                {missing > 0 ? (
                    <View style={styles.short}>
                        <Text variant="callout" tone="secondary" accessibilityLiveRegion="polite" style={styles.shortText}>{plural('create.short', missing, { have: String(balance ?? 0), need: String(price) })}</Text>
                        <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={t('lowBalance.buy')} onPress={async () => { await flushDraft(); router.push('/credits'); }} label={t('lowBalance.buy')} />
                    </View>
                ) : null}
                {error ? <Text variant="body" tone="danger" style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
                {note ? <Text variant="caption" tone="tertiary" style={styles.consent} accessibilityLiveRegion="polite">{note}</Text> : null}
                {!complete && results ? <><Text variant="caption">{t('libraryCreate.retryUpTo', { credits: String(price) })}</Text><Button variant="secondary" label={t('libraryCreate.newGeneration')} accessibilityLabel={t('libraryCreate.newNoCharge')} disabled={busy} onPress={newGeneration} /></> : null}
                <Card style={styles.costCard}>
                    <View style={styles.costTop}>
                        <View>
                            <SectionLabel style={styles.sectionLabel}>{t('create.workspace.total')}</SectionLabel>
                            <Text variant="title1" tone="warning" style={styles.cost} accessibilityLiveRegion="polite">{price === 0 ? t('opt.costFree') : t('create.workspace.cost', { credits: String(price) })}</Text>
                        </View>
                        <Text variant="caption" tone="secondary" style={styles.balance}>{t('create.workspace.balance', { credits: balance === null ? '—' : String(balance) })}</Text>
                    </View>
                    <Button variant="primary" accessibilityRole="button" accessibilityLabel={complete ? t('libraryCreate.newNoCharge') : generateLabel} accessibilityState={{ busy, disabled }} disabled={disabled} onPress={complete ? newGeneration : generate} label={complete ? t('libraryCreate.newGeneration') : price === 0 ? t('create.workspace.generateFree') : t('create.workspace.generate', { credits: String(price) })} loading={busy} />
                    <SectionLabel style={styles.refund}>{t('create.workspace.refund')}</SectionLabel>
                    <View style={styles.terms}>
                        <Text variant="caption" tone="tertiary">{t('create.workspace.terms')}{' '}</Text>
                        <Button variant="tertiary" size="sm" accessibilityRole="link" onPress={() => void router.push('/legal/terms')} label={t('create.workspace.termsLink')} />
                    </View>
                </Card>
            </KeyboardFormScrollView>
        </KeyboardScreen>
    );
}

// What Generate will cost, said before it is pressed. Free runs left today are applied first.
function costLine(price: number, n: number, freeLeft: number, unit: number): string {
    if (price === 0) return t('opt.costFree');
    if (n > 1 && freeLeft > 0) return plural('opt.costsPartial', price, { free: String(Math.min(freeLeft, n)), images: String(n) });
    if (n > 1) return plural('opt.costsBatch', price, { images: String(n) });
    return plural('form.costs', unit);
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    mutedInk: { color: p.textTertiary },

    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: ds.space.lg, paddingBottom: 48, gap: ds.space.md },
    section: { gap: ds.space.sm },
    settingsSection: { gap: ds.space.md, marginTop: ds.space.xxs },
    sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md },
    sectionLabel: { },
    sectionMeta: { },
    topic: { minHeight: 90 },
    prompt: { minHeight: 126, textAlignVertical: 'top' },
    skillsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.xs },
    skillsIntro: { color: p.textTertiary, },
    chips: { flexDirection: 'row', gap: ds.space.sm },
    short: { backgroundColor: p.bgElevated1, borderColor: p.warning, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.md, gap: ds.space.xs },
    shortText: { color: p.warning, fontVariant: ['tabular-nums'], },
    restored: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, paddingStart: ds.space.md },
    restoredText: { color: p.textSecondary, flexShrink: 1 },
    consent: { color: p.textTertiary, },
    rightsBox: { gap: ds.space.sm },
    rightsControl: { minHeight: MIN_TARGET, justifyContent: 'center', borderWidth: 1, borderColor: p.borderStrong, borderRadius: ds.radius.md, padding: ds.space.md, backgroundColor: p.bgElevated1 },
    rightsText: { color: p.textSecondary, },
    costCard: { gap: ds.space.md, padding: ds.space.lg, borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    costTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: ds.space.md },
    cost: { marginTop: ds.space.xs, color: p.warning, fontVariant: ['tabular-nums'], },
    balance: { color: p.textSecondary, fontVariant: ['tabular-nums'], },
    refund: { textAlign: 'center' },
    terms: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' },
    error: { color: p.danger },
}));
