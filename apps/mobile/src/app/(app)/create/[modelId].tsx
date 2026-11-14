import { useTemplateContract } from '../../../lib/useTemplateContract';
import { templatePhotoHints, templatePhotosUnavailable, templateRouteContract, templateBoundPrompt, fidelityBlocked, fidelityTemplateId } from '../../../lib/templateFidelity';
import { fetchSwapScene, swapSceneModel, type SwapScene } from '../../../lib/swapScenes';
import { fetchFreeAllowance } from '../../../lib/freeAllowance';
import { captureHandoffOwner } from '../../../lib/accountHandoffStore';
import { createFormSheets as sheets } from '../../../components/create/createFormStyles';
import { rememberFilmJob } from '../../../lib/filmGenerationReturns';
import { rememberSubmitted } from '../../../lib/submittedRequests';
import { acceptedSettings, createHandoff, nearestDuration, skillPromptHref } from '../../../lib/createHandoff';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { rawText } from '../../../lib/i18n/translate';
import { Image } from 'expo-image';
import { CostTick, CreateResult, type ResultBatch } from '../../../components/create/CreateResult';
import { refreshBalance } from '../../../lib/createResult';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import type { SubmitRequest } from '../../../lib/generationSubmit';
import { KeyboardFormScrollView } from '../../../components/KeyboardFormScrollView';
import { KeyboardScreen } from '../../../components/KeyboardScreen';
import { RevealOnFirstLayout } from '../../../components/create/RevealOnFirstLayout';
import { FormHeader } from '../../../components/create/FormHeader';
import { ModelPickerSheet } from '../../../components/create/ModelPickerSheet';
import { useModelSwitch } from '../../../components/create/useModelSwitch';
import { SectionLabel } from '../../../components/create/SectionLabel';
import { SourceDurationCard } from '../../../components/create/SourceDurationCard';
import { Text, TextField, Button, Card, Chip, themedStyles, useThemedStyles } from '../../../components/ui';
import { GENERATION_PROMPT_MAX } from '../../../lib/promptLimits';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { API_BASE, ApiError } from '../../../lib/api';
import { canDraw } from '../../../lib/drawOnImage';
import { createGenerationSubmit, generationSignature, unknownGenerationOutcome, type ChargeSnapshot, generationMessage } from '../../../lib/generationSubmit';
import { CameraPanel } from '../../../components/CameraPanel';
import { CharacterPanel } from '../../../components/CharacterPanel';
import { CreateOptions, type OptionValues } from '../../../components/CreateOptions';
import { AttachMore, UploadLimitNote } from '../../../components/create/AttachMore';
import { TemplatePhotoSlots } from '../../../components/TemplatePhotoSlots';
import { SourcePicker } from '../../../components/SourcePicker';
import { TemplateBanner } from '../../../components/TemplateBanner';
import { DEFAULT_CINEMA, buildCinemaPrompt, sanitizeCinema, type Cinema } from '../../../lib/cinemaCamera';
import { clearDraft, loadDraft, saveDraft } from '../../../lib/createDraftStore';
import { SAVED_DRAFT_VERSION, modelChoices, type CreateDraft, audioLengthInvalid, freeLeftFor, hasAnyOption, imageCount, inputsForIndex, optionsFor, resolveAudio, resolveResolution, resolveTier, seedIsInvalid, settingsInputs, takesImageCount, voiceIsMissing } from '../../../lib/createOptions';
import { loadVibe } from '../../../lib/creatorProfileStore';
import { defaultAspect, readDestinationAspect } from '../../../lib/creatorTaste';
import { nearestAspect, parseRatio, activeTemplate, normalizeTemplateCarry, templateOnOriginalModel } from '../../../lib/templateHandoff';
import { buildCharacterPrompt, sanitizePicks, type Picks } from '../../../lib/oddlingsBuilder';
import { useBalance } from '../../../lib/useBalance';
import { shortfall } from '../../../lib/lowBalance';
import { useFreeLeftState } from '../../../lib/useFreeLeft';
import { estimateCredits, fetchCatalog, kindOf, promptRequired, textInput, type CatalogModel } from '../../../lib/media';
import { MIN_TARGET, selectedState } from '../../../lib/a11y';
import { portraitAsPickedFile, startOddlingId } from '../../../lib/oddlingsAnimate';
import { legacyReferences, replaceSlotReferences, slotsFor, type GenerationReference, type PickedFile, type SlotName } from '../../../lib/sources';
import { ds } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { creativeFeature } from '../../../lib/creativeFeatures';
import { consumeCreativeSourceHandoff, readCreativeSourceHandoff } from '../../../lib/creativeSourceHandoff';
const PLACEHOLDER: Record<string, string> = { topic: 'form.topicPlaceholder' };
// The host part of an address, or '' when it is not one.
const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return ''; } };
export default function CreateWithModel() {
    const styles = useThemedStyles(sheets);
    const { modelId, swap, prompt: presetPrompt, duration: presetDuration, aspect: presetAspect, startOddling, tpl, tid, tmodel, tneeds, tsource, tratio, tposter, tnegative, recipe, sourceHandoff, switched, followup, kind, sourceJob, filmId, shotId, promptVersion, promptContext } = useLocalSearchParams<{ modelId: string; swap?: string; prompt?: string; duration?: string; aspect?: string; startOddling?: string; tpl?: string; tid?: string; tmodel?: string; tneeds?: string; tsource?: string; tratio?: string; tposter?: string; tnegative?: string; recipe?: string; sourceHandoff?: string; switched?: string; followup?: string; kind?: string; sourceJob?: string; filmId?: string; shotId?: string; promptVersion?: string; promptContext?: string }>();
    // A template also brings its name, picture, shape and what it needs; each is checked before it is used.
    const template = useMemo(() => activeTemplate({ tpl, tid, tmodel, tneeds, tsource, tratio, tposter, tnegative }, modelId, ['veyrnox.ai', hostOf(API_BASE)]), [tpl, tid, tmodel, tneeds, tsource, tratio, tposter, tnegative, modelId]);
    const templatePreset = templateOnOriginalModel({ tmodel }, modelId);
    const handedSources = useMemo(() => readCreativeSourceHandoff(typeof sourceHandoff === 'string' ? sourceHandoff : undefined, typeof recipe === 'string' ? recipe : undefined, modelId), [modelId, recipe, sourceHandoff]);
    const { api } = useAuth();
    const router = useRouter();
    const sceneServices = useRef({ api, router });
    const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
    useEffect(() => { sceneServices.current = { api, router }; }, [api, router]);
    const loadedEntry = useRef<{ swap?: string; modelId: string } | null>(null);
    const [model, setModel] = useState<CatalogModel | null>(null);
    const [swapScene, setSwapScene] = useState<SwapScene | null>(null);
    // A template (ADR-0120) opens this form with its prompt and length filled in; both stay editable.
    const [prompt, setPrompt] = useState(typeof presetPrompt === 'string' ? presetPrompt : '');
    const [duration, setDuration] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    // Storage keys of the files already uploaded, by slot, and the slots still uploading.
    const [references, setReferences] = useState<readonly GenerationReference[]>(() => handedSources?.references ?? legacyReferences(handedSources?.uploaded ?? {}, handedSources?.fromLibrary ?? {}));
    const [sending, setSending] = useState<Partial<Record<SlotName, boolean>>>({});
    const [error, setError] = useState<string | null>(null);
    const [opts, setOpts] = useState<OptionValues>({ aspect: null, count: 1, seed: '', negative: template?.negativePrompt || '', voice: '', audioSeconds: '' });
    const [cameraOn, setCameraOn] = useState(false);
    const [cinema, setCinema] = useState<Cinema>(DEFAULT_CINEMA);
    const [characterOn, setCharacterOn] = useState(false);
    const [character, setCharacter] = useState<Picks>({});
    const [restored, setRestored] = useState(false);
    const [recoveredPrompt, setRecoveredPrompt] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    useAnnouncement(note);
    // "Animate this portrait" (Oddlings): the cast portrait goes into the image slot like any picked file.
    const startId = startOddlingId(startOddling);
    const [startFile, setStartFile] = useState<PickedFile | null>(null);
    const [startProblem, setStartProblem] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const { left: freeMap, loading: freeLoading } = useFreeLeftState(refreshKey);
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [results, setResults] = useState<ResultBatch | null>(null);
    const [complete, setComplete] = useState(false);
    const [attaching, setAttaching] = useState(false);
    const [confirmed, setConfirmed] = useState(0);
    const batch = useRef(0);
    const balanceSeq = useRef(0);
    const retry = useRef<{ signature: string; request: SubmitRequest; count: number; unit: number; quote?: ChargeSnapshot } | null>(null);
    const balance = useBalance();
    // The newest unsaved draft, so leaving the screen (to buy credits, say) never loses the last words typed.
    const unsaved = useRef<{ draft: CreateDraft; owner: string | undefined; current: () => boolean } | null>(null);
    // The same request keeps its keys (one per image), so a retry after a dropped connection is charged once.
    const pending = useRef(createGenerationSubmit());
    const draftReady = useRef(false);
    useEffect(() => {
        const clear = () => { void Image.clearMemoryCache?.().catch(() => {}); batch.current++; balanceSeq.current++; pending.current.reset(); retry.current = null; setResults(null); setConfirmed(0); setComplete(false); setBusy(false); setPrompt(''); setReferences([]); unsaved.current = null; draftReady.current = false; };
        const unsubscribe = subscribeCacheUser(clear);
        return () => { unsubscribe(); batch.current++; balanceSeq.current++; };
    }, []);
    function newGeneration() {
        if (busy) return;
        batch.current++; balanceSeq.current++; pending.current.reset(); retry.current = null;
        setResults(null); setConfirmed(0); setComplete(false); setError(null); setNote(null);
    }
    useEffect(() => {
        // Changing any identity input drops the quote and continuation, even if later changed back.
        if (!retry.current) return;
        batch.current++; balanceSeq.current++; pending.current.reset(); retry.current = null;
        setResults(null); setConfirmed(0); setComplete(false); setError(null); setNote(null);
        // busy stays set: the submit lock holds until the outstanding request settles (its finally clears it).
    }, [swap, modelId, prompt, duration, opts, references, cameraOn, cinema, characterOn, character, template?.id]);
    useEffect(() => {
        consumeCreativeSourceHandoff(typeof sourceHandoff === 'string' ? sourceHandoff : undefined, typeof recipe === 'string' ? recipe : undefined, modelId);
    }, [modelId, recipe, sourceHandoff]);
    useEffect(() => {
        let live = true;
        const current = captureHandoffOwner();
        const valid = () => live && current();
        draftReady.current = false;
        const sceneChanged = loadedEntry.current?.swap !== swap;
        const entryChanged = sceneChanged || loadedEntry.current?.modelId !== modelId;
        if (entryChanged && (swap !== undefined || loadedEntry.current?.swap !== undefined)) { setModel(null); setSwapScene(null); setError(null); }
        loadedEntry.current = { swap, modelId };
        fetchCatalog()
            .then(async (all) => {
                if (!valid()) return;
                setCatalog(all);
                const scene = swap !== undefined ? await fetchSwapScene(sceneServices.current.api, swap) : null;
                if (!valid()) return;
                if (scene && scene.swapOffer !== modelId) { sceneServices.current.router.replace({ pathname: '/create/[modelId]', params: { modelId: scene.swapOffer, swap: scene.id } }); return; }
                setSwapScene(scene);
                const raw = all.find((m) => m.id === (scene?.swapOffer ?? modelId)) ?? null;
                const found = raw && scene ? swapSceneModel(raw, scene) : raw;
                setModel(found);
                if (found && kindOf(found.modality) === 'video') {
                    const wanted = Number(presetDuration);
                    setDuration(nearestDuration(found, wanted));
                }
                if (!found) setError(t('form.modelGone'));
                if (!found) return;
                const o = optionsFor(found);
                if (scene) { if (sceneChanged) { setPrompt(''); setReferences([]); setOpts({ aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' }); setCameraOn(false); setCharacterOn(false); } return; }
                // Where the person said the result will land (the vibe check) picks the opening ratio; no answer keeps 16:9.
                const vibe = await loadVibe();
                if (!valid()) return;
                // A template that has a shape of its own opens in the model's nearest one; otherwise the usual default.
                const guidedAspect = handedSources?.aspect;
                const handedAspect = nearestAspect(parseRatio(presetAspect), o.aspects);
                const aspect = handedAspect ?? (guidedAspect && o.aspects.includes(guidedAspect) ? guidedAspect : null) ?? nearestAspect(template?.ratio ?? null, o.aspects) ?? nearestAspect(parseRatio(await readDestinationAspect()), o.aspects) /* where it will go (ADR-0339) */ ?? defaultAspect(o.aspects, vibe?.answers ?? null);
                const base: OptionValues = { aspect, count: 1, seed: '', negative: template?.negativePrompt || '', voice: '', audioSeconds: '' };
                setReferences(handedSources?.references ?? legacyReferences(handedSources?.uploaded ?? {}, handedSources?.fromLibrary ?? {}));
                setNote(kind === 'prompt-unavailable' ? t('handoff.promptUnavailable') : [switched === '1' ? t('handoff.switchedModel', { model: found.name }) : null, handedSources?.adjusted ? t('handoff.referencesAdjusted', { count: handedSources.adjusted }) : null].filter(Boolean).join(' ') || null);
                if (handedSources?.settings) {
                    const saved = acceptedSettings(found, handedSources.settings);
                    setPrompt(typeof presetPrompt === 'string' ? presetPrompt : '');
                    setOpts({ ...saved.opts, aspect: handedAspect ?? saved.opts.aspect ?? aspect });
                    setCameraOn(saved.cameraOn); setCinema(saved.cinema); setCharacterOn(saved.characterOn); setCharacter(saved.character);
                    draftReady.current = true;
                    return;
                }
                // A template brings its own words; only a form opened bare gets the unsent draft back.
                if (typeof presetPrompt === 'string' || handedSources?.picks) {
                    setPrompt(typeof presetPrompt === 'string' ? presetPrompt : '');
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
                loadDraft(found.id, undefined, undefined, sceneServices.current.api).then((d) => {
                    if (!valid()) return;
                    if (d) {
                        setPrompt(d.prompt);
                        setRecoveredPrompt(d.prompt);
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
            .catch(() => { if (valid()) setError(t(swap !== undefined ? 'form.modelGone' : 'form.modelLoad')); });
        return () => { live = false; };
    }, [swap, modelId, presetDuration, presetAspect, handedSources, presetPrompt, template, switched]);
    // Carried into the form that Attach from device reopens: the words typed so far and the template that started it.
    const attachCarry = useMemo(() => {
        const out: Record<string, string> = {};
        const add = (key: string, value: unknown) => { if (typeof value === 'string' && value !== '') out[key] = value; };
        out.prompt = prompt;
        if (duration !== null) add('duration', String(duration));
        add('aspect', opts.aspect ?? undefined);
        add('recipe', recipe); add('followup', followup ?? handedSources?.followup); if (kind !== 'prompt-unavailable') add('kind', kind); add('sourceJob', sourceJob); add('startOddling', startOddling);
        add('filmId', filmId); add('shotId', shotId); add('promptVersion', promptVersion); add('promptContext', promptContext);
        add('tpl', tpl); add('tid', tid); add('tmodel', tmodel); add('tneeds', tneeds); add('tsource', tsource); add('tratio', tratio); add('tposter', tposter); add('tnegative', opts.negative);
        return normalizeTemplateCarry(out, modelId);
    }, [modelId, prompt, duration, opts.aspect, opts.negative, tpl, tid, tmodel, tneeds, tsource, tratio, tposter, recipe, followup, handedSources, kind, sourceJob, startOddling, filmId, shotId, promptVersion, promptContext]);
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
        const owner = getCacheUser(), current = captureHandoffOwner();
        unsaved.current = { draft, owner, current };
        const id = setTimeout(() => {
            unsaved.current = null;
            if (current()) saveDraft(draft, undefined, owner, sceneServices.current.api).catch(() => undefined);
        }, 600);
        return () => clearTimeout(id);
    }, [model, prompt, duration, opts, cameraOn, cinema, characterOn, character]);
    const flushDraft = useCallback(async () => {
        const draft = unsaved.current;
        unsaved.current = null;
        if (draft?.current()) await saveDraft(draft.draft, undefined, draft.owner, sceneServices.current.api).catch(() => undefined);
    }, []);
    // Closing the screen saves what was typed in the last moments too.
    useEffect(() => () => void flushDraft(), [flushDraft]);
    const modelSwitch = useModelSwitch(flushDraft, useCallback(() => setError(t('form.modelLoad')), []));
    const discardDraft = useCallback(() => {
        setPrompt('');
        setOpts((o) => ({ ...o, seed: '', negative: '', count: 1, voice: '', audioSeconds: '' }));
        setCameraOn(false);
        setCharacterOn(false);
        setCharacter({});
        setRestored(false);
        clearDraft(undefined, undefined, sceneServices.current.api).catch(() => undefined);
    }, []);
    const { contract: loadedContract, loading: contractLoading, retry: retryContract } = useTemplateContract(swapScene ? null : template?.id);
    if (!model || (swap !== undefined && swapScene?.id !== swap)) {
        return <View style={styles.screen}>{error ? <Text variant="body" tone="danger" style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : <ActivityIndicator color={styles.accentInk.color} />}</View>;
    }
    const isVideo = kindOf(model.modality) === 'video';
    const options = optionsFor(model), tier = resolveTier(options, opts.tier);
    const unit = swapScene?.credits ?? estimateCredits(model, duration, tier);
    const n = imageCount(model, opts.count);
    const resolution = resolveResolution(model, options, opts.resolution);
    const audio = resolveAudio(model, options, opts.audio);
    const freeLeft = freeLoading ? 0 : freeLeftFor(freeMap, model.id);
    // The camera words go into the prompt for image and video models; the price and the model do not change.
    const takesCharacter = kindOf(model.modality) === 'image' && textInput(model)?.key === 'prompt';
    const takesCamera = (kindOf(model.modality) === 'image' || isVideo) && textInput(model)?.key === 'prompt';
    // Character first, then the camera, as on the web. Both only rewrite the prompt.
    const withCharacter = takesCharacter && characterOn ? buildCharacterPrompt(prompt, character) : prompt === presetPrompt || prompt === recoveredPrompt ? prompt : prompt.trim();
    const text = takesCamera && cameraOn ? buildCinemaPrompt(withCharacter, cinema) : withCharacter;
    const text_ = textInput(model);
    const promptTooLong = !!text_ && text.length > text_.max;
    const contract = swapScene ? null : loadedContract; const contractMissing = !swapScene && !!templateRouteContract(template?.id) && !contract;
    const photoContract =  !cameraOn && !characterOn && fidelityTemplateId(contract, templateBoundPrompt(contract, text, modelId, contract?.slotCount || 1), modelId, { ...settingsInputs(options, { seed: opts.seed, negative: opts.negative, aspect: opts.aspect, voice: opts.voice, audioSeconds: opts.audioSeconds, resolution, audio, tier }), duration_seconds: isVideo ? duration : null }) ? contract : null;
    const boundCount = contract?.class === 'bound' && modelId === contract.modelId ? contract.slotCount || 0 : 0; const photosUnavailable = contract?.class === 'bound' && modelId === contract.modelId && templatePhotosUnavailable(contract, model?.capabilities?.media);
    const slots = slotsFor(model, swapScene).filter(slot => !photoContract || slot.slot === 'image' || references.some(ref => ref.slot === slot.slot)).map(slot => photoContract ? { ...slot, maxFiles: Math.min(slot.maxFiles ?? 1, photoContract.slotCount || 1), minSide: Math.max(slot.minSide || 0, photoContract.minPhotoDimension) } : slot);
    const waiting = attaching || Object.values(sending).some(Boolean);
    // New files join the latest references (never a stale copy), within each slot's room; the slot pickers show them
    // without remounting, so an upload in progress is never aborted.
    const placeAttached = (added: GenerationReference[]) => {
        setReferences(all => {
            const next = [...all];
            for (const ref of added) {
                const room = slots.find(x => x.slot === ref.slot)?.maxFiles ?? 1;
                const same = (x: GenerationReference) => x.origin === ref.origin && (x.origin === 'upload' ? x.key === (ref as typeof x).key : x.asset_id === (ref as { asset_id?: string }).asset_id);
                if (!next.some(same) && next.filter(x => x.slot === ref.slot).length < room) next.push(ref);
            }
            return next;
        });
    };
    const hasReference = references.length > 0 || !!startFile;
    const ready = !contractMissing && !photosUnavailable && (!boundCount || references.length === boundCount) && !fidelityBlocked(contract, template ? text : '') && (!photoContract || (references.length <= photoContract.requiredReferences.imageMax && references.every(ref => ref.slot === 'image'))) && (!swapScene || (references.length === swapScene.people && references.every(ref => ref.slot === 'image'))) && !waiting && !promptTooLong && slots.every(slot => (!slot.required || references.some(ref => ref.slot === slot.slot)) && references.filter(ref => ref.slot === slot.slot).length <= (slot.maxFiles ?? 1)) && (!promptRequired(model) || !!text.trim()) && !seedIsInvalid(opts.seed) && !voiceIsMissing(options, opts.voice) && !audioLengthInvalid(options, opts.audioSeconds);
    const requestPrompt = !cameraOn && !characterOn ? templateBoundPrompt(contract, text, modelId, references.length) : text;
    let request: SubmitRequest = { analyticsKind: kindOf(model.modality), modelId: model.id, swap: swapScene?.id, prompt: requestPrompt, templateId: prompt === contract?.sourcePrompt && !cameraOn && !characterOn && (contract?.class !== 'bound' || references.length === contract.slotCount) ? fidelityTemplateId(contract, requestPrompt, modelId, { ...settingsInputs(options, { seed: opts.seed, negative: opts.negative, aspect: opts.aspect, voice: opts.voice, audioSeconds: opts.audioSeconds, resolution, audio, tier }), duration_seconds: !swapScene && isVideo ? duration : null }) : undefined, confirmedCredits: unit, durationSeconds: !swapScene && isVideo ? duration : null, references, sourceRights: hasReference ? true : undefined, textKey: text_?.key, extraInputs: settingsInputs(options, { seed: opts.seed, negative: opts.negative, aspect: opts.aspect, voice: opts.voice, audioSeconds: opts.audioSeconds, resolution, audio, tier }), preset: !swapScene && templatePreset ? template?.id ?? undefined : undefined };
    if (request.templateId && typeof request.extraInputs?.negative_prompt === 'string') request = { ...request, extraInputs: { ...request.extraInputs, negative_prompt: request.extraInputs.negative_prompt.trimEnd() } };
    const signature = generationSignature(request, n);
    const matchingRetry = retry.current?.signature === signature ? retry.current : null;
    // Only an unchanged request retains its confirmed items and retry price.
    const quote = matchingRetry?.quote ?? pending.current.snapshot(request, n, matchingRetry?.unit ?? unit, freeLeft);
    const price = quote.total;
    const stageLine = template
        ? t('create.workspace.stageTemplate', { name: template.title })
        : t(hasReference ? 'create.workspace.stageReference' : text.trim() ? 'create.workspace.stagePrompt' : 'create.workspace.stageEmpty');
    const modelLabel = swapScene?.name ?? creativeFeature(typeof recipe === 'string' ? recipe : undefined)?.title ?? model.name;
    async function generate() {
        if (!model || (!ready && !matchingRetry) || busy || freeLoading || waiting) return;
        if (retry.current && !matchingRetry) newGeneration();
        const run: NonNullable<typeof retry.current> = matchingRetry ?? { signature, request, count: n, unit };
        retry.current = run;
        const generation = batch.current;
        const owner = getCacheUser();
        const current = () => generation === batch.current && owner === getCacheUser();
        setBusy(true); setError(null); setNote(null);
        let started = matchingRetry ? confirmed : 0;
        let firstId: string | null = null;
        try {
            await pending.current.run(api, run.request, run.count, count => { started = count; if (current()) setConfirmed(previous => Math.max(previous, count)); }, (id, index) => {
                firstId = firstId ?? id;
                if (!current()) return;
                void rememberFilmJob(id, attachCarry, prompt);
                const extraInputs = inputsForIndex(run.request.extraInputs ?? {}, index, run.count);
                void rememberSubmitted(id, { ...run.request, extraInputs }, attachCarry, { opts: { ...opts, count: 1, seed: extraInputs.seed === undefined ? opts.seed : String(extraInputs.seed) }, cameraOn, cinema, characterOn, character });
                setResults(previous => previous ? { ...previous, ids: previous.ids.includes(id) ? previous.ids : [...previous.ids, id] } : { ids: [id], modelId: model.id, kind: kindOf(model.modality), aspect: opts.aspect, duration, count: run.count });
            }, quote);
            if (!current()) return;
            clearDraft(undefined, undefined, sceneServices.current.api).catch(() => undefined);
            // A single Faceless Reel clip still opens its job page, where the sound step is offered (ADR-0279).
            const facelessSound = recipe === 'faceless-reel' && (followup ?? handedSources?.followup) === 'generated-sound' && model.id === 'wan-2.5-kie' && duration !== null && duration <= 8;
            if (run.count === 1 && firstId && facelessSound) router.replace({ pathname: '/job/[id]', params: { id: firstId, followup: 'faceless-sound' } });
            else setComplete(true);
        } catch (err) {
            if (!current()) return;
            if (err instanceof ApiError && err.code === 'price_changed' && Number.isInteger(err.body.expected_credits) && Number(err.body.expected_credits) >= 0) {
                let fresh = {};
                try { fresh = await fetchFreeAllowance(api); } catch { /* paid estimate */ }
                if (!current()) return;
                const quotedUnit = Number(err.body.expected_credits);
                retry.current = { ...run, unit: quotedUnit, quote: pending.current.snapshot(run.request, run.count, quotedUnit, freeLeftFor(fresh, model.id)) };
            } else retry.current = { ...run, quote: undefined };
            setError(generationMessage(err));
            if (run.count > 1) setNote(t(unknownGenerationOutcome(err) ? 'opt.startedUnknown' : 'opt.started', { started: String(started), count: String(run.count), next: String(started + 1) }));
        } finally {
            // Always release the lock here: a reset mid-request keeps busy set until the request settles.
            setBusy(false);
            if (current()) {
                setRefreshKey(key => key + 1);
                void refreshBalance(api, owner, current, balanceSeq);
            }
        }
    }
    const generation = batch.current;
    const owner = getCacheUser();
    const resultSettled = () => { if (generation === batch.current) void refreshBalance(api, owner, () => generation === batch.current, balanceSeq); };
    const payable = quote.payable ?? price;
    const missing = complete ? 0 : shortfall(balance, payable);
    const disabled = busy || waiting || (!complete && (freeLoading || (!ready && !matchingRetry) || missing > 0));
    // A swap scene, a Tools recipe or a bound template is made for one model; anywhere else the model row opens the picker.
    const choices = modelChoices(catalog, model), changeModel = choices.length > 1 && !swapScene && !creativeFeature(typeof recipe === 'string' ? recipe : undefined) && !boundCount && !busy && !waiting ? modelSwitch.open : undefined;
    const generateLabel = matchingRetry?.quote ? t('app.create.confirmPrice', { credits: String(price) }) : `${n > 1 ? t('opt.generateCount', { count: String(n) }) : t('slip.generate')}. ${costLine(price, n, freeLeft, unit)}`;
    return (
        <KeyboardScreen style={styles.screen}>
            <Stack.Screen options={{ title: t('label.Create') }} />
            <KeyboardFormScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <FormHeader modelLabel={modelLabel} modality={kindOf(model.modality) ?? model.modality} stageLine={stageLine} stage={results ? <RevealOnFirstLayout scroll={scrollRef}><CreateResult api={api} batch={results} catalog={catalog} onTerminal={resultSettled} /></RevealOnFirstLayout> : undefined}
                    onChangeModel={changeModel} onTemplates={!template && !results ? () => router.push('/create/presets') : undefined} />
                <ModelPickerSheet visible={modelSwitch.picking} models={choices} currentId={model.id} freeLeft={freeMap} onClose={modelSwitch.close} onPick={(id) => void modelSwitch.change(model, catalog.find(m => m.id === id), (target) => createHandoff(target, attachCarry, { opts, cameraOn, cinema, characterOn, character }, references, handedSources ?? undefined))} />
                {contract && !boundCount && <Text accessibilityLiveRegion="polite">{t(contract.photoGuidance)}</Text>} {photosUnavailable && <Text tone="danger" accessibilityLiveRegion="polite">{t('presets.fidelity.photosUnavailable')}</Text>}
                {contractMissing && (contractLoading ? <ActivityIndicator /> : <><Text accessibilityLiveRegion="polite">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={retryContract} /></>)}
                {fidelityBlocked(contract, template ? text : '') && <Text tone="danger" accessibilityLiveRegion="polite">{t('public.TemplateRecipe.sourceVideoUnsupported')}</Text>} {template && !templatePreset && <Text accessibilityLiveRegion="polite">{t('presets.fidelity.modelSwitch')}</Text>}
                {template && !fidelityBlocked(contract, text) && !request.templateId && <Text accessibilityLiveRegion="polite">{t('presets.fidelity.previewNotice')}</Text>}
                {template ? <TemplateBanner template={template} aspect={options.aspects.length ? opts.aspect : null} /> : null}
                {startId && takesStartImage ? <Text variant="caption" tone="tertiary" style={styles.consent} accessibilityLiveRegion="polite">{startProblem ?? t('oddlings.animate.startNote')}</Text> : null}
                {['swap-recast', 'swap-quick'].includes(model.id) ? <Text variant="caption" tone="secondary" style={styles.consent}>{t('app.create.swapConsentNotice')}</Text> : null}
                {slots.length && !photosUnavailable ? (
                    <View style={styles.section}>
                        <View style={styles.sectionTop}>
                            <SectionLabel style={styles.sectionLabel}>{t('create.workspace.references')}</SectionLabel>
                            <SectionLabel style={styles.sectionMeta}>{t('create.workspace.referencesMeta')}</SectionLabel>
                        </View>
                        <UploadLimitNote model={model} />
                        <View pointerEvents={attaching ? 'none' : 'auto'} style={{ gap: ds.space.md }}>
                        {boundCount ? <TemplatePhotoSlots key={`${template?.id}:${modelId}`} count={boundCount} hints={templatePhotoHints(contract)} model={model} api={api} references={references} onReferences={setReferences} onBusy={busy => setSending(previous => ({ ...previous, image: busy }))} /> : slots.map((s) => (
                            <SourcePicker
                                key={s.slot}
                                slot={s}
                                drawable={canDraw(model) && s.slot === 'image'}
                                tokens={model.id === 'seedance-2.0-reference' || /@(Image|Video|Audio)\d/i.test(prompt)}
                                api={api}
                                references={references.filter(ref => ref.slot === s.slot)}
                                onReferences={files => { setReferences(all => replaceSlotReferences(all, s.slot, files)); }}
                                onChange={() => {}}
                                onLibrary={() => {}}
                                onBusy={(b) => setSending((x) => ({ ...x, [s.slot]: b }))}
                                initial={s.slot === 'image' ? startFile : null}
                                initialReady={references.some(ref => ref.slot === s.slot)}
                                hint={s.slot === 'image' && model.id === 'seedance-2.0-reference' ? t('app.create.referenceLikenessNotice') : s.slot === 'image' && template?.needs ? t('create.template.needs', { what: template.needs }) : undefined}
                            />
                        ))}
                        </View>
                    </View>
                ) : null}
                {!swapScene && !boundCount && <View style={styles.section}><AttachMore hasSlots={slots.length > 0} api={api} current={model} carry={attachCarry} settings={{ opts, cameraOn, cinema, characterOn, character }} references={references} previous={handedSources ?? undefined} blocked={waiting} onBusy={setAttaching} onPlaced={placeAttached} /></View>}
                {text_ ? (
                    <View style={styles.section}>
                        <View style={styles.sectionTop}>
                            <SectionLabel style={styles.sectionLabel}>{text_.key === 'topic' ? t('form.topic') : t('create.workspace.prompt')}</SectionLabel>
                            <Text variant="footnote" tone="secondary">{text.length}/{text_.max}</Text>
                        </View>
                        <TextField
                            style={[styles.prompt, text_.key === 'topic' && styles.topic]}
                            value={prompt}
                            onChangeText={setPrompt}
                            placeholder={t(PLACEHOLDER[text_.key] ?? (promptRequired(model) ? 'form.describeCreate' : 'form.describeChange'))}
                            placeholderTextColor={styles.mutedInk.color}
                            accessibilityLabel={rawText(text_.key === 'topic' ? t('form.topic') : t('mobile.prompt'))}
                            multiline
                        />
                        {promptTooLong ? <Text tone="danger" accessibilityLiveRegion="polite">{t(text_.key === 'topic' ? 'public.TemplateRecipe.topicTooLong' : text_.max < GENERATION_PROMPT_MAX ? 'public.TemplateRecipe.promptTooLong' : 'public.TemplateRecipe.productPromptTooLong', { count: text.length, max: text_.max })}</Text> : null}
                        <View style={styles.skillsRow}>
                            <Text variant="caption" tone="tertiary" style={styles.skillsIntro}>{t('create.workspace.skills')}</Text>
                            <Button variant="tertiary" accessibilityRole="link" onPress={() => router.push(skillPromptHref('prompt-writer', prompt, model.id))} label={t('create.workspace.promptWriter')} />
                            <Button variant="tertiary" accessibilityRole="link" onPress={() => router.push(skillPromptHref('fix-my-prompt', prompt, model.id))} label={t('create.workspace.fixPrompt')} />
                        </View>
                    </View>
                ) : null}
                {restored ? (
                    <View style={styles.restored}>
                        <Text variant="body" tone="secondary" accessibilityLiveRegion="polite" style={styles.restoredText}>{t('opt.draftRestored')}</Text>
                        <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={t('opt.draftClear')} onPress={discardDraft} label={t('opt.draftClear')} />
                    </View>
                ) : null}
                {((isVideo && model.durations.length > 1) || hasAnyOption(options) || takesImageCount(model) || takesCharacter || takesCamera) ? (
                    <View style={styles.settingsSection}>
                        <View style={styles.sectionTop}>
                            <SectionLabel style={styles.sectionLabel}>{t('create.workspace.settings')}</SectionLabel>
                            {changeModel ? <Pressable accessibilityRole="button" accessibilityLabel={rawText(`${t('create.workspace.settingsMeta')}. ${t('chat.model.change')}`)} onPress={changeModel} hitSlop={12}><SectionLabel style={[styles.sectionMeta, styles.accentInk]}>{t('create.workspace.settingsMeta')}</SectionLabel></Pressable> : <SectionLabel style={styles.sectionMeta}>{t('create.workspace.settingsMeta')}</SectionLabel>}
                        </View>
                        {isVideo && model.durations.length > 1 ? (
                            <View style={styles.chips}>
                                {model.durations.map((d) => (
                                    <Chip key={d} label={t('create.lengthCost', { value1: d, credits: String(estimateCredits(model, d, tier)) })} accessibilityRole="button" accessibilityLabel={`${rawText(plural('form.seconds', d))}, ${t('create.workspace.cost', { credits: String(estimateCredits(model, d, tier)) })}`} accessibilityState={selectedState(duration === d)} selected={duration === d} onPress={() => setDuration(d)} />
                                ))}
                            </View>
                        ) : null}
                        {hasAnyOption(options) || takesImageCount(model) ? <CreateOptions options={options} values={opts} showCount={takesImageCount(model)} resolution={resolution} audio={audio} tier={tier} tierLabel={(id) => `${id === '4k' ? '4K' : id} · ${estimateCredits(model, duration, id)}`} outputPrice={plural('opt.outputPriceSame', unit)} onChange={setOpts} /> : null}
                        {takesCharacter ? <CharacterPanel on={characterOn} picks={character} onToggle={setCharacterOn} onChange={setCharacter} /> : null}
                        {takesCamera ? <CameraPanel on={cameraOn} value={cinema} onToggle={setCameraOn} onChange={setCinema} /> : null}
                    </View>
                ) : null}
                <SourceDurationCard model={model} />
                {missing > 0 ? (
                    <View style={styles.short}>
                        <Text variant="callout" tone="secondary" accessibilityLiveRegion="polite" style={styles.shortText}>{plural('create.short', missing, { have: String(balance ?? 0), need: String(payable) })}</Text>
                        <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={t('lowBalance.buy')} onPress={async () => { await flushDraft(); router.push('/credits'); }} label={t('lowBalance.buy')} />
                    </View>
                ) : null}
                {error ? <Text variant="body" tone="danger" style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
                {error && matchingRetry && !disabled ? <Button variant="secondary" accessibilityRole="button" label={t('recovery.retry')} onPress={() => void generate()} /> : null}
                {note ? <Text variant="caption" tone="tertiary" style={styles.consent} accessibilityLiveRegion="polite">{note}</Text> : null}
                {!complete && results ? <><Text variant="caption">{t('libraryCreate.retryUpTo', { credits: String(price) })}</Text><Button variant="secondary" label={t('libraryCreate.newGeneration')} accessibilityLabel={t('libraryCreate.newNoCharge')} disabled={busy} onPress={newGeneration} /></> : null}
                <Card style={styles.costCard}>
                    <View style={styles.costTop}>
                        <View>
                            <SectionLabel style={styles.sectionLabel}>{t('create.workspace.total')}</SectionLabel>
                            <CostTick value={price}><Text variant="title1" tone="warning" style={styles.cost} accessibilityLiveRegion="polite">{price === 0 ? t('opt.costFree') : t('create.workspace.cost', { credits: String(price) })}</Text></CostTick>
                        </View>
                        <Text variant="caption" tone="secondary" style={styles.balance}>{t('create.workspace.balance', { credits: balance === null ? '—' : String(balance) })}</Text>
                    </View>
                    <Button variant="primary" accessibilityRole="button" accessibilityLabel={rawText(complete ? t('libraryCreate.newNoCharge') : generateLabel)} accessibilityState={{ busy, disabled }} disabled={disabled} onPress={complete ? newGeneration : generate} label={complete ? t('libraryCreate.newGeneration') : matchingRetry?.quote ? generateLabel : price === 0 ? t('create.workspace.generateFree') : t('create.workspace.generate', { credits: String(price) })} loading={busy} />
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
