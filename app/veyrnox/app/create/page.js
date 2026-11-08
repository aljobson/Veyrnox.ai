'use client';
import { generationSourceState, sourceList, publicSlotMax, editSlotSource, moveSlotSource, sourcesForModel } from '../../../../lib/generationSourceSlots.mjs';
import LegalLink from '../../../../components/LegalLink';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { rich } from '../../../../lib/i18n/rich';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { Chip } from '../../_components/Chip';
import { clipCredits, modelAspectRatios, modelIdForName } from '../../_lib/tokens';
import { TemplateOpening, useTemplateOpening } from '../../_components/TemplateOpening';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged, GatewayError } from '../../_lib/gateway';
import { failedCreationCopy } from '../../../../lib/i18n/createCopy.mjs';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { SEEDANCE_REFERENCE_MODEL_ID, FRAME_MODEL_ID, REFERENCE_LIKENESS_ERROR } from '../../_lib/seedanceReference';
import { pushJobHistory } from '../../_lib/jobHistory';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { StudioJobGrid } from '../../_components/StudioJobGrid';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { IMAGE_COUNTS, takesImageCount, imageCount, inputsForIndex, batchNote, sendInOrder, submitErrorCode, createBatch, allocationSnapshot } from '../../_lib/imageBatch';
import { useCatalog } from '../../_lib/useCatalog';
import { useFreeAllowance } from '../../_lib/useFreeAllowance';
import { freeLeftFor } from '../../_lib/freeAllowance';
import { sourceDurationLimit } from '../../_lib/modelPricing';
import { SourceDurationCard } from '../../_components/SourceDurationCard';
import { takeStudioDraft } from '../../_lib/landingDraft';
import { clearTemplateMediaHandoff, hasTemplateMediaHandoff, takeTemplateMediaHandoff, templateMediaHandoffMatches } from '../../_lib/templateMediaHandoff';
import { takeVideoSoundContinuation, writeVideoSoundContinuation } from '../../_lib/resultContinuation';
import { oddlingPortrait, buildOddlingAnimationPrompt } from '../../_lib/oddlingStudio';
import { fetchTemplate } from '../../_lib/useTemplates';
import { resolveTemplateDraft, draftForTemplate, templateArrival, createPromptModelAvailable } from '../../_lib/templateDraft';
import { templateStartIdFor } from '../../../../lib/templateStartCheck';
import { templateSourceUnsupported } from '../../_lib/templateSourceBlock';
import { nearestOption } from '../../../../lib/aspectShapes.mjs';
import { DEFAULT_CINEMA, buildCinemaPrompt } from '../../_lib/cinema';
import { CameraPanel } from '../../_components/CameraPanel';
import { CharacterPanel } from '../../_components/CharacterPanel';
import { buildCharacterPrompt, sanitizeOddlingPicks } from '../../_lib/character';
import { DrawOnImage } from '../../_components/DrawOnImage';
import { SourcePickers } from '../../_components/SourcePickers';
import { attachCapacity, attachPool, planAttachments } from '../../../../lib/createAttach.mjs';
import { prepareUploads, needsConversion } from '../../_lib/uploadConvert.mjs';
import { LibraryPicker } from '../../_components/LibraryPicker';
import { AddFilesDialog } from '../../_components/AddFilesDialog';
import { GenerationSettings } from '../../_components/GenerationSettings';
import { VoiceDescription } from '../../_components/VoiceDescription';
import { ControlRow } from '../../_components/ControlRow';
import { TemplateHandoffCard } from '../../_components/TemplateHandoffCard';
import { TemplatePicker } from '../../_components/TemplatePicker';
import { CreateGoalPicker } from '../../_components/CreateGoalPicker';
import { TIERS, TIER_LABEL, filterByTier } from '../../_lib/modelTiers';
import { modelsForGoal, starterModel } from '../../_lib/starterModels';
import { audioDurationConfig, audioDurationIsInvalid, settingsInputs, voiceIsMissing } from '../../_lib/generationSettings';
import { promptText, promptIsMissing, promptPlaceholderDiagnostic as promptPlaceholder } from '../../_lib/promptBox';
import { generateHintKey, HINT_CODES } from '../../_lib/generateHint';
import { ParticleButton } from '@/components/ParticleButton';
import { jobStateUi, SLOW_MODEL_WAIT } from '../../_lib/studioStates';
import { useCreateJourney } from '../../_lib/useCreateJourney';
import useCreateDraftRecovery from '../../_lib/useCreateDraftRecovery';
import { getJourney, trackJourneyJob } from '../../_lib/veyJourneyStore';
import { outputDurationLabel, mediaGenerationSources } from '../../_lib/chatMedia';
import { uploadSourceFile } from '../../_lib/uploadSourceFile';
import { generationSlotKind, generationMimeTypes } from '../../../../lib/generationSourceSlots.mjs';
import { GENERATION_PROMPT_MAX } from '../../../../lib/generationPromptLimits.js';
import { SwapSceneEntry } from '../../_components/SwapSceneEntry';
import { swapSceneModel, applySwapScene } from '../../_lib/swapSceneForm';
// Auto Short stays hidden until launch unless this browser opts in
// (CLAUDE.md "Delivery": new user paths behind localStorage.veyrnox_*).
const AUTO_SHORT_FLAG = 'veyrnox_auto_short';
const CREATE_CONTROL_TARGETS = Object.freeze({
  prompt: '[data-assistant-target="create.prompt"]',
  models: '[data-assistant-target="create.models"]',
  duration: '[data-assistant-target="create.duration"]',
  aspect: '[data-assistant-target="create.aspect"]',
  upload: '[data-assistant-target="create.upload"]',
  cost: '[data-assistant-target="create.cost"]',
});

function readFlag(name) {
  try { return window.localStorage.getItem(name) === '1'; } catch { return false; }
}

const LOCAL_ERRORS = {source_reattach_required: {"code": "source_reattach_required"}, source_count_exceeded: {"code": "source_count_exceeded"},poll_unreachable: {"code": "poll_unreachable"}, model_gated: {"code": "model_gated"}, source_required: {"code": "source_required"}, consent_required: {"code": "consent_required"}, inputs_invalid_prompt: {"code": "inputs_invalid:prompt"}, inputs_invalid_voice_description: {"code": "inputs_invalid:voice_description"}, inputs_invalid_duration: {"code": "inputs_invalid:duration"}};

function errorFor(e) {
  return e instanceof GatewayError || ['source_reattach_required', 'source_count_exceeded'].includes(e?.code) ? { code: e.code, retryAfter: e.retryAfter, expectedCredits: e.body?.expected_credits } : { code: 'internal' };
}

// Off on the server and first paint, then whatever this browser has stored.
const never = () => () => {};
const autoShortFlag = () => readFlag(AUTO_SHORT_FLAG);
const off = () => false;

export default function CreateStudio() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const translation = useRef(t);
  translation.current = t;
  const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));
  const creditLabel = value => t(pluralKey(t, locale, 'app.create.credits', value), { count: number(value) });
  const generationCostLabel = value => value === 0 ? t('publish.plan.colFree') : t('app.create.cost',{count:number(value)});
  const { models: catalogModels, live: catalogLive, loading: catalogLoading } = useCatalog();
  const freeMap = useFreeAllowance(); // ADR-0069: free jobs left today per model; empty while the feature is off
  const autoShortOn = useSyncExternalStore(never, autoShortFlag, off);

  const [modelId, setModelId] = useState(() => starterModel(catalogModels, 'image')?.id || '');
  const [goal, setGoal] = useState('image');
  const [presetParam, setPresetParam] = useState(null);
  const [templateData, setTemplateData] = useState(); // the whole template behind presetParam, from /api/templates/<id>; undefined until read, null when none
  const openingTemplate = useTemplateOpening(catalogLoading, templateData);
  const [accountEpoch, setAccountEpoch] = useState(0); // bumped when the account changes; drops conversions in flight
  const [swap, setSwap] = useState({ id: null, scene: null, loading: false });
  const swapId = swap.id;
  const models = catalogModels.filter((m) => createPromptModelAvailable(m, autoShortOn));
  if (swapId !== null) {
    const sceneModel = catalogModels.find(m => m.id === swap.scene?.swapOffer);
    models.splice(0, models.length, ...(sceneModel ? [swapSceneModel(sceneModel, swap.scene)] : []));
  }
  // Bumped at the moment the model or account changes, so a conversion started before cannot land after.
  const sourceEpoch = useRef(0);
  const chooseModel = (id) => { sourceEpoch.current += 1; setModelId(id); };
  const [tier, setTier] = useState(null);
  const [duration, setDuration] = useState('5s');
  const [audioDurations, setAudioDurations] = useState({});
  const [aspect, setAspect] = useState('16:9');
  const [recoveredPrompt, setRecoveredPrompt] = useState(null); // Recovery has no template provenance; preserve its unedited bytes.
  const [typed, setPrompt] = useState(null); // null until the user types or a draft is restored
  // Start image for models whose catalog capabilities declare an image slot.
  // Sources for the model's media slots: { image|video|audio: { file, previewUrl } },
  // or { assetId, previewUrl, label } for an image picked from the Library.
  const [sources, setSources] = useState({});
  const [animationPortrait, setAnimationPortrait] = useState(null);
  const [portraitStatus, setPortraitStatus] = useState('');
  const [libraryFor, setLibraryFor] = useState(null);
  const [drawing, setDrawing] = useState(false);
  // Uploads can carry a real face or voice. The rights statement is part of the
  // Terms and Acceptable Use Policy; the gateway still records it on the job (0096).
  const [consent, setConsent] = useState(true);
  const [cinemaOn, setCinemaOn] = useState(false);
  const [cinema, setCinema] = useState(DEFAULT_CINEMA);
  const [seed, setSeed] = useState('');
  const [negative, setNegative] = useState('');
  const [voice, setVoice] = useState(''); // the voice in words, for a speech model that takes one
  const [characterOn, setCharacterOn] = useState(false);
  const [character, setCharacter] = useState({});
  const [oddlingTransfer, setOddlingTransfer] = useState(null);
  const [count, setCount] = useState(1);
  const [recipeId] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('recipe'));
  const [plannedFollowup, setPlannedFollowup] = useState(null);
  const [continuationError, setContinuationError] = useState('');
  const [attachNotice, setAttachNotice] = useState('');

  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const onUnreachable = useCallback(() => setError(LOCAL_ERRORS.poll_unreachable), []);
  const { jobs, generating, startJobs, addJob, clearJobs } = useStudioJobs({ onUnreachable });
  const job = jobs.length === 1 ? jobs[0] : null;
  const likenessRejected = job?.state === 'failed' && job.error_code === REFERENCE_LIKENESS_ERROR && job.model_id === SEEDANCE_REFERENCE_MODEL_ID;
  const frameFallback = models.find((m) => m.id === FRAME_MODEL_ID);
  // True while a batch is still being sent, so New generation cannot clear it halfway.
  const [sending, setSending] = useState(false);
  // Offline notice: drafts stay readable, and the notice says why Generate will not work.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  const incomingDraft = useRef(false);
  // Keep the requested ratio until the live catalog (or the complete registry-derived
  // fallback after a failed read) resolves the selected model's real capabilities.
  const incomingAspect = useRef('');
  const arrivalApplied = useRef(false);
  const [templateEntry] = useState(() => typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('preset')));
  // Ordinary studio entries must not restart (or cancel media loads) when the catalog arrives.
  const arrivalModels = templateEntry ? catalogModels : null;
  const arrivalLoading = templateEntry && catalogLoading;

  useEffect(() => {
    if (!swap.scene) return;
    sourceEpoch.current += 1;
    applySwapScene(swap.scene, { setModelId, setGoal, setDuration, setPrompt });
    setPresetParam(null); setTemplateData(null); setConsent(false); setAnimationPortrait(null);
    setCinemaOn(false); setCharacterOn(false); setSeed(''); setNegative('');
    setSources(current => { for (const item of Object.values(current).flatMap(sourceList)) if (item.file) URL.revokeObjectURL(item.previewUrl); return {}; });
  }, [swap.scene]);

  // ?model=<id> from landing tiles / hero cards. Read once on mount —
  // avoids the Suspense boundary useSearchParams demands on client pages.
  // ?duration=10s and the prompt come from the landing price slip; the
  // duration effect below drops a length the model does not sell.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('swap')) { incomingDraft.current = true; return; }
    const presetId = params.get('preset');
    // Reserve the incoming recipe before waiting so recovery cannot replace it.
    if (presetId) incomingDraft.current = true;
    if ((presetId && arrivalApplied.current) || arrivalLoading) return;
    const controller = new AbortController();
    const start = (preset) => {
      arrivalApplied.current = true;
      const requested = params.get('model') || (preset && modelIdForName(preset.model));
      let storedDraft = null;
      try { storedDraft = takeStudioDraft(window.sessionStorage, requested, Date.now(), preset?.id); } catch { /* The URL recipe still works. */ }
      const arrival = preset ? templateArrival(preset, arrivalModels || [], params, storedDraft) : null;
      const wanted = arrival ? arrival.modelId : requested;
      const hadTemplateMedia = hasTemplateMediaHandoff(window);
      const matchedTemplateMedia = Boolean(preset && templateMediaHandoffMatches(window, preset.id));
      let takenTemplateMedia = null;
      if (preset) takenTemplateMedia = takeTemplateMediaHandoff(window, preset.id, wanted);
      else if (hadTemplateMedia) clearTemplateMediaHandoff(window);
      const arrivalModel = (arrivalModels || catalogModels).find((candidate) => candidate.id === wanted);
      const handedMedia = takenTemplateMedia && arrivalModel?.media?.image && generationSlotKind('image') === 'image' ? takenTemplateMedia : null;
      if (wanted) {
        setModelId(wanted);
        // Show only the arriving model's kind (video template = video models), not every kind.
        setGoal(catalogModels.find((m) => m.id === wanted)?.kind || 'all');
      }
      setTemplateData(preset ?? null);
      setPresetParam(preset?.id ?? params.get('preset')); // the template's id, from its studio link (an older id resolves to it); sent only while its own model is selected
      if (/^\d{1,2}s$/.test(params.get('duration') || '')) setDuration(params.get('duration'));
      const videoSoundDraft = params.get('continue') === 'faceless-sound' && wanted === 'mmaudio-v2-video'
        ? takeVideoSoundContinuation(window.sessionStorage)
        : null;
      const portrait = oddlingPortrait(params.get('oddlingPhoto'));
      const draft = (arrival ? arrival.draft : resolveTemplateDraft(preset, wanted, storedDraft))
        || (portrait ? { prompt: buildOddlingAnimationPrompt(portrait.id, params.get('motion')), durationSeconds: 5 } : null);
      incomingDraft.current = Boolean(draft || videoSoundDraft);
      if (videoSoundDraft) {
        setPrompt(videoSoundDraft.prompt);
        setSources({ video: { assetId: videoSoundDraft.jobId, previewUrl: videoSoundDraft.assetUrl, label: videoSoundDraft.label } });
        setConsent(true);
      } else if (draft) setPrompt(draft.prompt);
      const recoveredSources = draft ? storedDraft?.sources : null;
      if (!videoSoundDraft && (recoveredSources || handedMedia)) {
        const handedSources = handedMedia ? Object.fromEntries(Object.entries(handedMedia).map(([slot, file]) => [slot, { file, previewUrl: URL.createObjectURL(file) }])) : {};
        setSources({ ...(recoveredSources || {}), ...handedSources });
        setConsent(true);
      }
      if (matchedTemplateMedia) setAttachNotice(handedMedia ? '' : translation.current('app.create.templatePhotoHandoff'));
      if (storedDraft?.followup) setPlannedFollowup(storedDraft.followup);
      if (draft?.aspect) incomingAspect.current = draft.aspect;
      if (draft?.durationSeconds && (preset || !/^\d{1,2}s$/.test(params.get('duration') || ''))) setDuration(`${draft.durationSeconds}s`);
      if (draft?.negativePrompt) setNegative(draft.negativePrompt);
      if (params.get('passport') === '1' && storedDraft?.oddlingPicks) {
        const imported = sanitizeOddlingPicks(storedDraft.oddlingPicks);
        if (Object.keys(imported).length) {
          setCharacter(imported);
          setCharacterOn(true);
          setOddlingTransfer(imported);
        }
      }
      if (portrait) {
        setAnimationPortrait(portrait);
        setPortraitStatus(translation.current('app.create.photoLoading',{name:portrait.name}));
        fetch(portrait.image, { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error('portrait_load_failed');
          const blob = await response.blob();
          if (blob.type !== 'image/webp' || !blob.size || blob.size > 5 * 1024 * 1024) throw new Error('portrait_invalid');
          if (controller.signal.aborted) return;
          const file = new File([blob], `${portrait.id}.webp`, { type: 'image/webp' });
          setSources((current) => ({ ...current, image: { file, previewUrl: portrait.image, label: portrait.name } }));
          setPortraitStatus(translation.current('app.create.photoReady',{name:portrait.name}));
        }).catch(() => {
          if (!controller.signal.aborted) setPortraitStatus(translation.current("app.create.photoFailed"));
        });
      }
    };
    if (presetId) fetchTemplate(presetId).then((preset) => { if (!controller.signal.aborted) start(preset); });
    else start(null);
    return () => controller.abort();
  }, [arrivalLoading, arrivalModels]);

  const draftRecovery = useCreateDraftRecovery({
    incoming: incomingDraft,
    draft: { modelId, goal, prompt: typed, duration, aspect, count, sources, seed, negative, voice, audioDurations, cinemaOn, cinema, characterOn, character },
    apply: (saved, restoredSources) => {
      setRecoveredPrompt(saved.prompt);
      chooseModel(saved.modelId); setGoal(saved.goal); setPrompt(saved.prompt); setDuration(saved.duration);
      setAspect(saved.aspect); setCount(saved.count); setSeed(saved.seed); setNegative(saved.negative); setVoice(saved.voice);
      setAudioDurations(saved.audioDurations); setCinemaOn(saved.cinemaOn); setCinema({ ...DEFAULT_CINEMA, ...saved.cinema });
      setCharacterOn(saved.characterOn); setCharacter(sanitizeOddlingPicks(saved.character));
      setSources(restoredSources); setConsent(true); setAnimationPortrait(null); setTier(null);
    },
    reset: () => {
      setPrompt(null); setSources(current => { Object.values(current).flatMap(sourceList).forEach(source => { if (source.file) URL.revokeObjectURL(source.previewUrl); }); return {}; });
      setConsent(true); setGoal('image'); chooseModel(starterModel(catalogModels, 'image')?.id || '');
      setDuration('5s'); setAspect('16:9'); setCount(1); setCharacterOn(false); setCharacter({}); setOddlingTransfer(null);
      setCinemaOn(false); setCinema(DEFAULT_CINEMA); setSeed(''); setNegative(''); setVoice(''); setAudioDurations({});
      setAnimationPortrait(null); setPresetParam(null); setTier(null); clearJobs(); setError(null);
      // A conversion the previous account started must not land in this one's form.
      sourceEpoch.current += 1; attachSeq.current += 1; setAttachConverting(false); setAttachNotice(''); setAccountEpoch(epoch => epoch + 1);
    },
  });

  // If the selected id isn't in the (live or fallback) catalog, fall back to
  // the goal's cheapest prompt-only model so cost never silently reads 0.
  // Wait for the live catalog first: the tokens.js fallback lacks newer models,
  // and resetting against it threw away any ?model= it didn't list.
  useEffect(() => {
    if (draftRecovery.restoring || catalogLoading || !catalogLive || !models.length) return;
    if (models.some((m) => m.id === modelId)) return;
    const first = starterModel(models, goal) || starterModel(models, 'all') || models[0];
    chooseModel(first.id);
  }, [models, modelId, catalogLoading, catalogLive, goal, draftRecovery.restoring]);

  const model = models.find((m) => m.id === (swap.scene?.swapOffer || modelId)) || null;
  // The controls describe the next draft, not the already submitted job.
  // Keep the result attached to its own model even while the user browses.
  const resultModel = job ? catalogModels.find((m) => m.id === job.model_id) : null;
  const resultModelName = job?.model_name || resultModel?.name || job?.model_id || 'Generation';
  const soundRequested = recipeId === 'faceless-reel' && plannedFollowup === 'generated-sound' && job?.model_id === 'wan-2.5-kie';
  const soundEligible = soundRequested && job?.state === 'succeeded' && Boolean(job.asset_url) && Number(job.duration_seconds) <= 8;
  // Completion must not turn an imminent reset click into a charged submission.
  const hasJobs = jobs.length > 0;
  const catalogStatus = catalogLoading ? 'loading' : catalogLive ? 'live' : 'unavailable';
  const activeTemplate = templateStartIdFor(presetParam, templateData, modelId) ? templateData : null;
  // Changing the model keeps the chosen template on screen; it just stops being sent (the gateway takes a template only on its own model).
  const keptTemplate = !activeTemplate && presetParam && templateData?.id === presetParam ? templateData : null;
  const keptTemplateModel = keptTemplate ? models.find((m) => m.id === modelIdForName(keptTemplate.model)) : null;
  const prompt = promptText(typed, model); // a starter shot until then, on picture and clip models only (see promptBox)
  // An exact template prompt that points at a source video or audio we cannot supply cannot reproduce its preview (templateSourceBlock).
  const sourceBlocked = !!activeTemplate && templateSourceUnsupported(activeTemplate) && prompt === activeTemplate.prompt;
  // The picked model stays listed even when the tier filter would hide it.
  const goalModels = modelsForGoal(models, goal);
  const listed = filterByTier(goalModels, tier);
  const visibleModels = model && !listed.includes(model) ? [model, ...listed] : listed;
  // Lengths the gateway will actually sell for this model, from the catalog.
  // Rendering anything else offers a price the server then refuses.
  const durations = (model && model.durations && model.durations.length ? model.durations : [5]).map((s) => `${s}s`);
  const audioDurationControl = audioDurationConfig(model);
  const audioDuration = audioDurationControl
    ? audioDurations[model.id] ?? String(audioDurationControl.defaultValue)
    : '';
  const invalidAudioDuration = audioDurationIsInvalid(model, audioDuration);
  const fixedDurationLabel = model?.presentation?.fixedDurationLabel;
  const sourceDurationMax = sourceDurationLimit(model);
  const templateDuration = sourceDurationMax
    ? t('app.create.duration.follows')
    : model?.kind === 'audio' && audioDurationControl
      ? `${audioDuration} ${t('app.create.seconds')}`
      : (model?.kind === 'video' || model?.kind === 'audio') && fixedDurationLabel
        ? fixedDurationLabel
        : model?.kind === 'video' ? outputDurationLabel(model, Number(duration.replace('s', ''))) : null;
  const media = model?.media || {};
  const animationMismatch = !!animationPortrait && (model?.kind !== 'video' || !media.image?.required);
  const { missingSource: missingSlot, needsReattach, overLimit, hasSource: hasUpload } = generationSourceState(media, sources);
  // Only pictures this model actually takes count: a video-only attachment, or a picture kept from another model, never reaches the provider.
  const templateImageSources = Object.entries(media)
    .filter(([slot]) => generationSlotKind(slot) === 'image')
    .flatMap(([slot]) => sourceList(sources[slot]))
    .filter(source => !source?.needsUpload && (source?.file || source?.assetId || source?.sourceKey));
  const templateImageCount = templateImageSources.length;
  const missingSource = missingSlot || (swap.scene && templateImageCount !== swap.scene.people);
  const templateImageSource = templateImageSources.find(source => source?.file || source?.label) || templateImageSources[0] || null;
  const templateImageRequired = Object.entries(media).some(([slot, spec]) => generationSlotKind(slot) === 'image' && spec?.required);
  const missingConsent = false;
  const missingVoice = voiceIsMissing(model, voice);
  const missingPrompt = promptIsMissing(model, prompt);
  // Camera text suits pictures and clips; audio and speech would read it aloud.
  const isShort = !!model?.takesTopic;
  const promptLimit = isShort ? 200 : model?.promptMax || GENERATION_PROMPT_MAX;
  const promptLimitKey = isShort ? 'public.TemplateRecipe.topicTooLong' : promptLimit < GENERATION_PROMPT_MAX ? 'public.TemplateRecipe.promptTooLong' : 'public.TemplateRecipe.productPromptTooLong';
  const resultAspect = jobs[0]?.aspect_ratio || (hasJobs ? '16:9' : isShort ? '9:16' : aspect);
  const takesCamera = !isShort && (model?.kind === 'image' || model?.kind === 'video');
  const preparedPromptLength = isShort ? prompt.trim().length : finalPrompt().length;
  const promptTooLong = preparedPromptLength > promptLimit;
  // Why Generate is greyed out (see _lib/generateHint): empty when there is nothing the person can fix.
  const hintKey = generateHintKey({ ready: catalogStatus === 'live' && balance != null, gated: !!model?.gated, sending, hasJobs, promptTooLong,
    needsReattach, overLimit, missingSource, animationMismatch, missingConsent, missingPrompt, missingVoice, invalidAudioDuration });
  const hintText = !hintKey ? '' : hintKey === 'reattach' ? t('app.create.reattach')
    : hintKey === 'duration' ? t('app.create.durationInvalid', { min: number(audioDurationControl?.min), max: number(audioDurationControl?.max) })
    : tOr(t, `app.create.error.${HINT_CODES[hintKey]}`, ERROR_COPY[HINT_CODES[hintKey]] || t('app.create.error.unknown'));
  // Only offer aspect ratios explicitly declared by this model's provider contract.
  const aspectOptions = isShort ? [] : modelAspectRatios(model);
  const unitCost = swap.scene ? swap.scene.credits : model ? (model.kind === 'video' ? clipCredits(model.credits, Number(duration.replace('s', ''))) : model.credits) : 0;
  // Other models always send one; the count control is image-only.
  const n = imageCount(model, count);
  // The server decides what is free; the first `freeLeft` jobs of a batch are, the rest cost the catalog price.
  const freeLeft = freeLeftFor(freeMap, modelId);
  const formIdentity = useMemo(() => ({}), [swapId, modelId, prompt, duration, aspect, n, seed, negative, voice, audioDuration, cinemaOn, cinema, characterOn, character, sources, consent, presetParam, accountEpoch]);
  const continuation = useRef(null);
  const [batchView, setBatchView] = useState(null);
  const activeBatch = batchView?.identity === formIdentity ? batchView : null;
  const quote = activeBatch?.quote ?? allocationSnapshot(activeBatch ?? { accepted: Array(n).fill(null), unknown: new Set() }, activeBatch?.unit ?? unitCost, freeLeft);
  const cost = quote.total;
  // Unknown items replay their retained key, so only the rest must be affordable.
  const payable = quote.payable ?? cost;
  const durationKey = durations.join(',');
  // `generating` is derived from `jobs`, which is only set AFTER the await in
  // onSubmit. Between the click and that setState the button stayed enabled,
  // so a second click minted a second idempotency key — a legitimately new
  // job to ledger_debit, and a second debit. The server is idempotent per
  // key; the client was defeating it by changing the key.
  const inFlight = useRef(false);
  useCreateJourney({ model, models, catalogLive, prompt, characterOn, character, sources, duration, aspect, n, cost, balance,
    missingSource: missingSource || draftRecovery.blocked, missingConsent, missingPrompt, missingVoice, animationMismatch, generating, sending, jobs, error, seed, negative, cinemaOn, cinema,
    setModelId, setPrompt, setSources, setConsent, setDuration, setAnimationPortrait });

  // A 10s selection must not survive a switch to a model that only sells 5s:
  // the gateway would reject it and the quoted price would have been double.
  // A restored Film Studio draft can name a model absent from the fallback
  // catalog. Preserve its duration until that model's real lengths arrive.
  useEffect(() => {
    if (draftRecovery.restoring || catalogLoading || !catalogLive || !model) return;
    const available = durationKey.split(',');
    if (!available.includes(duration)) setDuration(available[0]);
  }, [catalogLoading, catalogLive, model, durationKey, duration, draftRecovery.restoring]);

  function setAudioDuration(value) {
    if (!model?.id) return;
    setAudioDurations((previous) => ({ ...previous, [model.id]: value }));
  }

  function pickSource(slot, file, asset = null, index) {
    draftRecovery.sourceEdited();
    if (file || asset) setAttachNotice('');
    setConsent(true);
    setSources(previous => {
      const old = sourceList(previous[slot]);
      const removed = index !== undefined ? old[index] : publicSlotMax(media[slot]) === 1 || (!file && !asset) ? old : [];
      for (const item of sourceList(removed)) if (item?.file) URL.revokeObjectURL(item.previewUrl);
      const source = file ? { file, previewUrl: URL.createObjectURL(file) } : asset ? { assetId: asset.id, previewUrl: asset.url, label: asset.label } : null;
      return editSlotSource(previous, slot, source, index, publicSlotMax(media[slot]));
    });
  }

  const [templatesOpen, setTemplatesOpen] = useState(false);
  // Picking a template here does what arriving on ?preset=<id> does: its model,
  // prompt and settings load, and the user's own files stay where the new model
  // has a slot for them. The template is a reference only; nothing is charged.
  async function applyTemplate(card) {
    setTemplatesOpen(false);
    const preset = await fetchTemplate(card.id); // the picker lists cards; the prompt comes with the whole template
    if (!preset) return;
    attachSeq.current += 1; // a paperclip conversion still running must not undo this choice
    setAttachConverting(false);
    setAttachNotice('');
    const nextId = modelIdForName(preset.model);
    const nextModel = models.find((m) => m.id === nextId);
    const draft = draftForTemplate(preset, nextId);
    if (!nextModel || !draft) return;
    setTemplateData(preset);
    setPresetParam(preset.id);
    setGoal(nextModel.kind || 'all');
    setTier(null);
    chooseModel(nextId);
    setPrompt(draft.prompt);
    setDuration(`${draft.durationSeconds}s`);
    setNegative(draft.negativePrompt);
    if (draft.aspect) {
      if (nextId === modelId) { const nearest = nearestOption(draft.aspect, aspectOptions); if (nearest) setAspect(nearest); }
      else incomingAspect.current = draft.aspect;
    }
    setSources((previous) => {
      const { sources: kept, dropped } = sourcesForModel(previous, nextModel.media);
      for (const item of dropped) if (item?.file) URL.revokeObjectURL(item.previewUrl);
      return kept;
    });
  }
  // The always-visible paperclip: the files' types pick the slots on the open model, which never changes
  // (files it has no slot for are refused); with no model open the files choose one.
  // HEIC, AVIF, GIF, MOV and WebM are converted to a stored type first (uploadConvert.mjs).
  // A newer attach supersedes one still converting, and the plan is made
  // against the page as it is when conversion ends, not when it started.
  const attachSeq = useRef(0);
  const [addFilesOpen, setAddFilesOpen] = useState(false);
  const [attachConverting, setAttachConverting] = useState(false);
  const [sourcesConverting, setSourcesConverting] = useState(false);
  const latestAttach = useRef(null);
  useEffect(() => { latestAttach.current = { models, model, sources }; });
  // Files from the Add files dialog, in the order picked: device files ({file}) and
  // generated ones ({asset}). A generated file stands in by its type until a slot takes it.
  // The current model is always kept (a template's model stays).
  async function attachFiles(entries) {
    setAddFilesOpen(false);
    const seq = ++attachSeq.current;
    const epoch = sourceEpoch.current;
    const picked = entries.filter(entry => entry.file).map(entry => entry.file);
    if (picked.some(needsConversion)) { setAttachNotice(t('app.create.convert.working')); setAttachConverting(true); }
    const items = [], failed = [];
    try {
      for (const entry of entries) {
        if (entry.asset) { items.push({ type: entry.asset.mimeType, asset: entry.asset }); continue; }
        const ready = await prepareUploads([entry.file]);
        items.push(...ready.files); failed.push(...ready.failed);
      }
    } finally { if (attachSeq.current === seq) setAttachConverting(false); }
    if (attachSeq.current !== seq) return;
    if (sourceEpoch.current !== epoch) { setAttachNotice(''); return; }
    const { models: currentModels, model: currentModel, sources: currentSources } = latestAttach.current;
    const failure = failed.length ? t(`app.create.convert.${failed[0].code}`) : '';
    const pool = attachPool(currentModels, currentModel);
    const plan = planAttachments(pool, currentModel, items);
    if (!plan) { setAttachNotice(failure || t('app.create.attach.unsupported')); return; }
    const switched = plan.model.id !== currentModel?.id;
    setAttachNotice([failure, switched && t('app.create.attach.switched', { name: plan.model.name }), plan.unused.length && t('app.create.attach.unused', { count: plan.unused.length })].filter(Boolean).join(' '));
    if (switched) { setPresetParam(null); setGoal(plan.model.kind); chooseModel(plan.model.id); }
    for (const source of Object.values(currentSources).flatMap(sourceList)) if (source.file) URL.revokeObjectURL(source.previewUrl);
    setSources({});
    const positions = {};
    for (const { slot, file } of plan.assignments) pickSource(slot, file.asset ? null : file, file.asset || null, (positions[slot] = (positions[slot] || 0) + 1) - 1);
  }

  function applyDrawing(file) {
    setDrawing(false);
    pickSource('image', file, null, 0);
  }

  const uploadSource = uploadSourceFile;

  useEffect(() => {
    if (catalogLoading || !model) return;
    const requested = incomingAspect.current;
    if (requested) {
      incomingAspect.current = '';
      if (aspectOptions.includes(requested)) setAspect(requested);
      else if (aspectOptions.length) setAspect(nearestOption(requested, aspectOptions) ?? aspectOptions[0]);
      return;
    }
    if (aspectOptions.length && !aspectOptions.includes(aspect)) setAspect(aspectOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, templateData, model?.id, aspectOptions.join(',')]);

  // ── balance fetch + focus revalidation ────────────────────────────
  const loadBalance = useCallback(async () => {
    try {
      const b = await gatewayFetch('/balance');
      setBalance(b.balance);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) return;
      setBalance(null);
    }
  }, []);

  useEffect(() => {
    loadBalance();
    const onFocus = () => loadBalance();
    const onBalance = () => loadBalance();
    window.addEventListener('focus', onFocus);
    window.addEventListener('veyrnox:balance-changed', onBalance);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('veyrnox:balance-changed', onBalance);
    };
  }, [loadBalance]);

  // Character traits go first, the camera description last; each keeps the
  // result within the selected model's generation-prompt contract.
  function finalPrompt() {
    let text = (templateData && prompt === templateData.prompt) || prompt === recoveredPrompt ? prompt : prompt.trim();
    if (model?.kind === 'image' && characterOn) text = buildCharacterPrompt(text, character);
    if (takesCamera && cinemaOn) text = buildCinemaPrompt(text, cinema);
    return text;
  }

  // ── submit ────────────────────────────────────────────────────────
  // N images are N separate generations: each its own key, debit, refund path
  // and job. Sent one at a time; the first failure stops the rest, and none is
  // ever retried under a new key.
  async function onSubmit() {
    if (draftRecovery.restoring || draftRecovery.blocked || attachConverting || sourcesConverting) return;
    if (inFlight.current || sending || generating || !model || balance == null || payable > balance) return;
    if (catalogStatus !== 'live' || sourceBlocked) return;
    inFlight.current = true;
    if (model.gated) { inFlight.current = false; setError(LOCAL_ERRORS.model_gated); return; }
    if (animationMismatch) { inFlight.current = false; setError(LOCAL_ERRORS.source_required); return; }
    if (needsReattach) { inFlight.current = false; setError(LOCAL_ERRORS.source_reattach_required); return; }
    if (overLimit) { inFlight.current = false; setError(LOCAL_ERRORS.source_count_exceeded); return; }
    if (missingSource) { inFlight.current = false; setError(LOCAL_ERRORS.source_required); return; }
    if (missingConsent) { inFlight.current = false; setError(LOCAL_ERRORS.consent_required); return; }
    if (missingPrompt) { inFlight.current = false; setError(LOCAL_ERRORS.inputs_invalid_prompt); return; }
    if (promptTooLong) { inFlight.current = false; setError(LOCAL_ERRORS.inputs_invalid_prompt); return; }
    if (missingVoice) { inFlight.current = false; setError(LOCAL_ERRORS.inputs_invalid_voice_description); return; }
    if (invalidAudioDuration) { inFlight.current = false; setError(LOCAL_ERRORS.inputs_invalid_duration); return; }
    setError(null);
    setSending(true);
    const submittedTask = getJourney().task;
    const submittedPresentation = {
      model_name: model.name,
      duration_seconds: model.kind === 'video' ? Number(duration.replace('s', '')) : undefined,
      ...(isShort ? { aspect_ratio: '9:16' } : aspectOptions.length ? { aspect_ratio: aspect } : {}),
    };
    const run = (continuation.current?.identity === formIdentity ? continuation.current : null) ?? { ...createBatch(n, () => makeIdempotencyKey()), identity: formIdentity, unit: unitCost, swap: model.swap };
    continuation.current = run;
    run.quote = quote;
    run.confirm = false;
    const keys = run.keys;
    // An Auto Short takes only its topic; the pipeline picks the format.
    const inputs = isShort ? { topic: prompt.trim() } : {
      prompt: finalPrompt(),
      aspect_ratio: aspectOptions.length ? aspect : undefined,
      duration_seconds: !model.swap && model.kind === 'video' ? Number(duration.replace('s', '')) : undefined,
      ...settingsInputs(model, { seed, negative, voice, duration: audioDuration }),
    };
    // strip undefined so server sees a clean object
    Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);

    let failureCode = null;
    try {
      // Only the slots this model takes; a leftover upload from another model stays local.
      // Each file is uploaded once and its key reused by every request.
      run.sources ??= await mediaGenerationSources(model, sources, uploadSource);
      run.inputs ??= inputs;
      const { references, source_keys, source_assets } = run.sources;
      const anySource = source_keys.length + source_assets.length > 0;
      const { started, error: failure } = await sendInOrder(n, async (i) => {
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: modelId, swap: run.swap, idempotency_key: keys[i], inputs: inputsForIndex(run.inputs, i, n),
            max_charge_credits: quote.ceilings[i],
            preset: templateStartIdFor(presetParam, templateData, modelId) || undefined,
            references,
            consent: anySource ? true : undefined,
          }),
        });
        // A job that took a free allowance (ADR-0069) cost nothing; the server says so.
        const jobCredits = submitted.free_allowance === true ? 0 : run.unit;
        // The first accepted job replaces the previous click's jobs.
        (i === 0 ? startJobs : addJob)({ job_id: submitted.job_id, state: 'queued', credits: jobCredits, model_id: modelId, ...submittedPresentation });
        if (i === 0) trackJourneyJob(submitted.job_id, model.kind, submittedTask);
        pushJobHistory({
          job_id: submitted.job_id,
          model_id: modelId,
          credits: jobCredits,
          prompt: prompt.slice(0, 60),
          name: prompt.slice(0, 40),
        });
        if (submitted.balance_after != null) setBalance(submitted.balance_after);
        return submitted;
      }, run, makeIdempotencyKey);
      if (started > 0) notifyBalanceChanged();
      if (failure) {
        const err = errorFor(failure);
        const code = submitErrorCode(err.code);
        failureCode = code;
        if (code === 'price_changed' && Number.isInteger(err.expectedCredits) && err.expectedCredits >= 0) {
          // Await a fresh allowance before freezing the confirmation; never reuse the stale banner.
          let fresh = {};
          try { const reply = await gatewayFetch('/free-allowance'); fresh = reply?.enabled ? reply.left : {}; } catch { /* paid quote is safe */ }
          run.unit = err.expectedCredits;
          run.quote = allocationSnapshot(run, run.unit, freeLeftFor(fresh, modelId));
          run.confirm = true;
        } else run.quote = null;
        setError({ ...err, code, note: batchNote(started, n, code) });
      } else continuation.current = null;
    } catch (e) {
      const err = errorFor(e);
      failureCode = submitErrorCode(err.code);
      setError(err);
    } finally {
      // A definitive failure with no accepted or uncertain items needs a new batch key.
      if (failureCode && !run.accepted.some(Boolean) && !run.confirm && !run.unknown.size && failureCode !== 'outcome_unknown') continuation.current = null;
      inFlight.current = false;
      setBatchView(continuation.current ? { ...continuation.current } : null);
      setSending(false);
    }
  }

  // Leaves the running jobs to finish in the background (JobWatcher announces
  // them); the charge stands, so this never claimed to cancel anything.
  function cancel() {
    continuation.current = null;
    setBatchView(null);
    clearJobs();
    setError(null);
  }

  function continueWithGeneratedSound() {
    setContinuationError('');
    const saved = writeVideoSoundContinuation(window.sessionStorage, {
      jobId: job?.job_id,
      assetUrl: job?.asset_url,
      duration: Number(job?.duration_seconds),
    });
    if (!saved) {
      setContinuationError(t('app.create.soundHandoffError'));
      return;
    }
    router.push('/app/create?model=mmaudio-v2-video&continue=faceless-sound');
  }

  function pickGoal(nextGoal) {
    const next = starterModel(models, nextGoal);
    setGoal(nextGoal);
    setTier(null);
    // A goal chip is a browsing filter, not a request to discard a linked
    // template. If that template's model already satisfies the chosen goal,
    // keep the exact model/reference pair intact. Switching to another media
    // kind is the deliberate replacement path and clears the attribution.
    if (activeTemplate && model && (nextGoal === 'all' || model.kind === nextGoal)) return;
    setPresetParam(null);
    chooseModel(next?.id || '');
  }

  function focusCreateControl(target) {
    if (target === 'upload' && templateImageCount === 0) {
      setAddFilesOpen(true);
      return;
    }
    const selector = CREATE_CONTROL_TARGETS[target];
    const section = selector ? document.querySelector(selector) : null;
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
    ].join(',');
    const candidates = [
      ...(section.matches(focusable) ? [section] : []),
      ...section.querySelectorAll('[aria-pressed="true"]:not([disabled])'),
      ...section.querySelectorAll(focusable),
    ];
    const control = candidates.find((candidate, index) => candidates.indexOf(candidate) === index
      && (typeof candidate.getClientRects !== 'function' || candidate.getClientRects().length > 0)) || section;
    if (control === section && !section.hasAttribute('tabindex')) section.tabIndex = -1;
    control.focus({ preventScroll: true });
  }

  const swapEntry = <Suspense fallback={null}><SwapSceneEntry onChange={setSwap} accountEpoch={accountEpoch} /></Suspense>;
  if (swapId !== null && (swap.loading || !swap.scene || !model)) return <div className="min-h-dvh">{swapEntry}<AppNav balance={balance} active="create" /><Main><p role="status">{swap.loading || catalogLoading ? t('app.create.openingTemplate') : t('app.chat.error.model_not_found')}</p></Main></div>;

  return (
    <div className="min-h-dvh">
      {swapEntry}
      {openingTemplate && <TemplateOpening name={openingTemplate.name} />}
      <AppNav balance={balance} active="create" />

      <Main inert={draftRecovery.restoring} aria-busy={draftRecovery.restoring} className="max-w-[1500px] mx-auto px-4 sm:px-8 pt-6 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_auto_1fr] gap-6">
        {/* ============ CANVAS ============ */}
        <div className="lg:col-start-1 lg:row-start-1">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.untitled")}</div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] mt-1">{t("label.Create")}</h1>
              {swap.scene && <p className="text-vx-fg-muted">{swap.scene.name}</p>}
            </div>
            <Chip tone="neutral">{draftRecovery.saved ? Object.values(sources).flatMap(sourceList).some(source => source.file) ? t("app.create.settingsSaved") : t("app.create.savedInTab") : t("app.create.unsaved")}</Chip>
          </div>

          <div data-assistant-target="create.result" className="scroll-mt-24">
          {jobs.length > 1 ? <StudioJobGrid jobs={jobs} aspect={resultAspect} /> : (
            <div
              className={`relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`}
              style={{ aspectRatio: resultAspect.replace(':', '/') }}
            >
              {job?.asset_url ? (
                <JobAssetPreview job={job} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  {generating ? (
                    <div className="text-center">
                      <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">
                        <span aria-hidden="true">●</span> {tOr(t, `app.library.status.${job.state === 'failed' && job.refunded !== true ? 'failed_pending' : job.state}`, jobStateUi(job).label)} · {resultModelName.toUpperCase()}
                      </div>
                      <div className="mt-2 font-vx-mono text-[42px] font-bold vx-num">…</div>
                      {SLOW_MODEL_WAIT[job?.model_id] && (
                        <div className="text-xs text-vx-fg-body mt-2">{tOr(t, `app.data.wait.${job.model_id}`, SLOW_MODEL_WAIT[job.model_id])}</div>
                      )}
                      <div className="text-xs text-vx-fg-muted mt-2">{t("app.create.keepRunning")}</div>
                    </div>
                  ) : job?.state === 'failed' ? (
                    <div className="text-center max-w-md px-6">
                      <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-danger">
                        <span aria-hidden="true">✕</span> {tOr(t, `app.library.status.${job.state === 'failed' && job.refunded !== true ? 'failed_pending' : job.state}`, jobStateUi(job).label)}
                      </div>
                      <div className="mt-2 text-sm text-vx-fg-body">
                        {failedCreationCopy(t, locale, job, failedJobCopy(job))}
                      </div>
                      {likenessRejected && frameFallback && (
                        <button type="button" data-testid="create-switch-to-frame-model" onClick={() => { setError(null); chooseModel(frameFallback.id); }}
                          className="mt-3 min-h-11 rounded-full border border-vx-accent/50 px-4 py-2 font-vx-mono text-[11px] font-bold text-vx-accent hover:bg-vx-accent/10">
                          {t('app.create.referenceLikenessSwitch')}</button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full border border-vx-border/60 flex items-center justify-center mx-auto opacity-70">
                        <div className="w-0 h-0 border-s-[16px] border-s-vx-fg-muted border-y-[10px] border-y-transparent ms-1" />
                      </div>
                      <div className="mt-3 text-sm text-vx-fg-muted">{t("app.create.promptOrPreset")}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </div>

          {soundEligible && (
            <section className="mt-3 rounded-2xl border border-vx-accent/35 bg-vx-accent/[0.06] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
              <div><p className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-accent">{t('app.create.soundPassEyebrow')}</p><p className="mt-1 text-sm font-extrabold text-vx-fg">{t('app.create.soundPassTitle')}</p><p className="mt-1 text-xs leading-5 text-vx-fg-muted">{t('app.create.soundPassHelp')}</p></div>
              <button type="button" onClick={continueWithGeneratedSound} className="mt-3 min-h-11 shrink-0 rounded-full bg-vx-accent px-5 py-2.5 text-sm font-extrabold text-vx-accent-ink sm:mt-0">{t('app.create.soundPassAction')}</button>
            </section>
          )}
          {soundRequested && job?.state === 'succeeded' && !soundEligible && <p className="mt-3 text-xs leading-5 text-vx-fg-muted">{t('app.create.soundPassDuration')}</p>}
          {continuationError && <p role="alert" className="mt-3 text-xs text-vx-danger">{continuationError}</p>}

          <textarea
            data-assistant-target="create.prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label={isShort ? t("app.create.topic") : t("mobile.prompt")}
            rows={3}
            className="scroll-mt-24 mt-3 w-full bg-vx-panel border border-vx-field rounded-lg p-3.5 text-sm text-vx-fg placeholder:text-vx-fg-faint resize-none focus:outline-hidden focus:border-vx-accent"
            placeholder={helperCopy(t, locale, promptPlaceholder(model))}
          />
          {promptTooLong && <p role="alert" className="mt-2 text-xs font-bold text-vx-danger">{t(promptLimitKey, { count: preparedPromptLength, max: promptLimit })}</p>}
          {!online && <p role="status" data-testid="create-offline" className="mt-2 rounded-lg border border-vx-warn/40 bg-vx-warn/[0.07] px-3 py-2 text-xs text-vx-fg-body">{t('app.create.offline')}</p>}
          {(draftRecovery.restoring || draftRecovery.status) && <div role="status" data-testid="create-draft-recovery" data-restoring={draftRecovery.restoring} className="mt-2 rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg-muted">
            {draftRecovery.restoring ? t("app.create.restoring") : draftRecovery.status}
            {draftRecovery.failed && <button type="button" onClick={draftRecovery.retry} className="ms-2 min-h-11 underline text-vx-accent">{t("app.create.retryDraft")}</button>}
          </div>}
          {oddlingTransfer && (
            <section role="status" data-assistant-target="create.oddling-handoff" className="mt-3 flex flex-col gap-3 rounded-xl border border-vx-accent/40 bg-vx-accent/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-accent">{t("app.create.oddlingLoaded")}</div>
                <div className="mt-1 text-sm font-extrabold text-vx-fg">{t('app.create.characterLinked',{name:oddlingTransfer.oddling_name || t('app.create.editedCharacter')})}</div>
                <p className="mt-1 text-xs text-vx-fg-muted">
                  {[oddlingTransfer.body_type, oddlingTransfer.wardrobe_style, oddlingTransfer.hair].filter(Boolean).join(' · ')}
                </p>
              </div>
              {model?.kind === 'image' && <button type="button" onClick={() => document.querySelector('[data-assistant-target="create.character"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="vx-press min-h-11 shrink-0 rounded-full border border-vx-accent/50 px-3 py-2 text-xs font-extrabold text-vx-accent hover:bg-vx-accent/10">
                {t("app.create.reviewCharacter")}</button>}
            </section>
          )}
          {(activeTemplate || keptTemplate) && <TemplateHandoffCard
            preset={activeTemplate || keptTemplate}
            otherModelName={keptTemplate ? (keptTemplateModel?.name || keptTemplate.model) : ''}
            canChooseSource={Boolean(activeTemplate?.needs && Object.keys(media).length)}
            onChooseSource={() => setAddFilesOpen(true)}
            settings={{
              prompt,
              model: model?.name,
              aspect: aspectOptions.length ? aspect : null,
              duration: templateDuration,
              cost: generationCostLabel(cost),
              sourceRequired: templateImageRequired,
              sourceLabel: templateImageSource?.file?.name || templateImageSource?.label || (templateImageCount > 0 ? t('app.create.sources.image.label') : ''),
            }}
            onEdit={focusCreateControl}
          />}
          {activeTemplate && templateImageCount > 0 && (
            <p role="status" data-testid="template-reference-overrides" className="mt-3 rounded-xl border border-vx-accent/30 bg-vx-panel p-3 text-xs text-vx-fg-body">
              {t(templateImageRequired ? 'app.create.templateReferenceRequired' : 'app.create.templateReferenceOverrides')}</p>
          )}
          {model?.takesVoice && <VoiceDescription value={voice} onChange={setVoice} />}

          {animationPortrait && <div role="status" className="mt-4 rounded-xl border border-vx-accent/30 bg-vx-panel p-4 text-sm text-vx-fg-body">{portraitStatus}{animationMismatch && <p className="mt-2 text-vx-danger">{t("app.create.animationModel")}</p>}</div>}
          {(
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* A template on a text-only model cannot use a picture (it would not reach the provider), so offer no slot for one. */}
              {!(activeTemplate && Object.keys(media).length === 0) && <>
                <button type="button" data-testid="create-add-files" disabled={attachConverting || sourcesConverting} onClick={() => setAddFilesOpen(true)}
                  className="vx-press min-h-10 font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg disabled:opacity-50 pointer-coarse:min-h-11">
                  {t('app.create.addFiles.button')}</button>
                <span className="text-xs text-vx-fg-muted">{t('app.create.attach.hint')}</span>
              </>}
              <button type="button" data-testid="create-open-templates" disabled={attachConverting || sourcesConverting} onClick={() => setTemplatesOpen(true)}
                className="vx-press ms-auto min-h-10 shrink-0 rounded-full border border-vx-accent/50 px-3.5 py-1.5 font-vx-mono pointer-coarse:min-h-11 text-[11px] font-bold text-vx-accent hover:bg-vx-accent/10 disabled:opacity-50">
                {t('app.create.templates.open')}</button>
            </div>
          )}
          {attachNotice && <p role="status" className="mt-2 text-xs text-vx-fg-muted">{attachNotice}</p>}
          {addFilesOpen && <AddFilesDialog capacity={attachCapacity(model)} onAdd={attachFiles} onClose={() => setAddFilesOpen(false)} />}
          {templatesOpen && <TemplatePicker models={models} goal={goal} onPick={applyTemplate} onClose={() => setTemplatesOpen(false)} />}
          {['swap-recast', 'swap-quick'].includes(modelId) && <p role="note" data-testid="swap-consent-notice" className="mt-2 text-xs text-vx-fg-muted">{t('app.create.swapConsentNotice')}</p>}
          {modelId === SEEDANCE_REFERENCE_MODEL_ID && <p role="note" data-testid="reference-likeness-notice" className="mt-2 text-xs text-vx-fg-muted">{t('app.create.referenceLikenessNotice')}</p>}
          <div className="scroll-mt-24" data-assistant-target={Object.keys(media).length ? 'create.upload' : undefined}>
            <SourcePickers tokens={/@(Image|Video|Audio)\d/i.test(prompt)} media={media} sources={sources} onPick={pickSource} onConvertingChange={setSourcesConverting} resetKey={`${modelId}|${accountEpoch}`} epochRef={sourceEpoch} locked={attachConverting} onReorder={(slot, from, to) => { setConsent(true); setSources(prev => moveSlotSource(prev, slot, from, to)); }}
              onDraw={model?.kind === 'image' ? () => setDrawing(true) : null} onLibrary={setLibraryFor} />
          </div>
          {Object.values(sources).flatMap(sourceList).some(source => source.file) && <p className="mt-2 text-xs text-vx-fg-muted">{t("app.create.reattach")}</p>}
          {libraryFor && (
            <LibraryPicker kind={generationSlotKind(libraryFor)} mimeTypes={generationMimeTypes(generationSlotKind(libraryFor))}
              onClose={() => setLibraryFor(null)}
              onPick={(item) => { pickSource(libraryFor, null, item); setLibraryFor(null); }} />
          )}


          {drawing && sourceList(sources.image)[0]?.file && (
            <DrawOnImage file={sourceList(sources.image)[0].file} onDone={applyDrawing} onCancel={() => setDrawing(false)} />
          )}

        </div>

        {/* ============ GENERATE ============ */}
        {/* Sits straight under the prompt and its inputs on desktop; on a phone it
            drops to the end of the page and stays pinned to the screen. */}
        <div data-create-cost-card className="order-last sticky bottom-3 z-30 rounded-2xl border border-vx-border bg-vx-panel p-5 shadow-2xl lg:order-none lg:col-start-1 lg:row-start-2 lg:self-start lg:static lg:shadow-none">
          <div data-assistant-target="create.cost" tabIndex={-1} className="scroll-mt-24 flex items-baseline justify-between">
            <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.totalCost")}</span>
            <span className="font-vx-mono text-[12px] text-vx-fg-muted vx-num">
              {t('app.create.balanceLabel',{count:balance == null ? '—' : balance.toLocaleString(localeTag(locale, 'en-US'))})}
            </span>
          </div>
          <div className="mt-1 font-vx-mono text-[36px] font-bold text-vx-money vx-num">{generationCostLabel(cost)}</div>
          {freeLeft > 0 && (
            <div role="status" className="mt-1 font-vx-mono text-[11px] tracking-[0.08em] text-vx-accent">
              {n > freeLeft ? t(pluralKey(t,locale,'app.create.freePartial',freeLeft),{free:number(freeLeft),total:number(n),left:number(freeLeft)}) : t(pluralKey(t,locale,'app.create.freeLeft',freeLeft),{count:number(freeLeft)})}
            </div>
          )}
          {sourceBlocked && <p role="note" data-source-unsupported className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/[0.08] px-3 py-2 text-xs text-vx-fg-body">{t('public.TemplateRecipe.sourceVideoUnsupported')}</p>}
          <p id="vx-generate-why" aria-live="polite" className={hintText ? 'mt-3 text-xs text-vx-fg-muted' : 'sr-only'}>{hintText}</p>
          <ParticleButton
            data-assistant-target="create.generate"
            aria-describedby={hintText ? 'vx-generate-why' : undefined}
            onClick={hasJobs && !activeBatch ? cancel : onSubmit}
            className="scroll-mt-24 mt-4 w-full flex items-center justify-between bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-vx-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={draftRecovery.restoring || draftRecovery.blocked || sending || attachConverting || sourcesConverting || (!hasJobs && (catalogStatus !== 'live' || sourceBlocked || !model || model.gated || animationMismatch || missingPrompt || promptTooLong || missingVoice || invalidAudioDuration || balance == null || payable > balance || missingSource || missingConsent)) || (!!activeBatch && (balance == null || payable > balance)) || !!activeBatch?.confirm}
            aria-label={sending ? undefined : hasJobs && !activeBatch ? t("app.create.newNoCharge") : model?.gated ? undefined : n > 1 ? t(pluralKey(t,locale,cost===0?'app.create.generateImagesFree':'app.create.generateImagesPaid',n),{count:number(n),credits:creditLabel(cost)}) : t(cost===0?'app.create.generateFree':'app.create.generatePaid',{credits:creditLabel(cost)})}
          >
            <span>{sending ? t("app.publish.inbox.sending") : hasJobs && !activeBatch ? t("app.create.newGeneration") : model?.gated ? t("app.create.premiumGated") : n > 1 ? t('app.create.generateCount',{count:number(n)}) : t("label.Generate")}</span>
            <span className="font-vx-mono text-sm">{hasJobs && !activeBatch ? t("app.create.noCharge") : generationCostLabel(cost)}</span>
          </ParticleButton>
          <div className="mt-2 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-fg-faint text-center">
            {model?.gated ? t("app.create.premiumClosed") : t("mobile.refund")}
          </div>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-vx-fg-muted">
            {rich(t('app.create.commercial'),{terms:<LegalLink element="Link" href="/legal/terms" className="text-vx-accent underline underline-offset-2">{t('home.publish.terms')}</LegalLink>})}
          </p>
          {activeBatch?.confirm && <button type="button" disabled={sending || generating || balance == null || payable > balance} onClick={onSubmit} className="vx-press mt-3 min-h-11 w-full rounded-lg border border-vx-border p-3 hover:border-vx-accent disabled:opacity-50">{t('app.create.confirmPrice', { credits: creditLabel(cost) })}</button>}
          {activeBatch && <button type="button" disabled={sending} onClick={cancel} className="mt-2 min-h-11 w-full p-2">{t('app.create.startNewBatch')}</button>}
          {balance != null && payable > balance && !model?.gated && (
            <div className="mt-4 rounded-xl border border-vx-money/40 bg-vx-money/[0.06] p-4 text-sm text-vx-fg-body">
              <p className="font-bold text-vx-fg">{t(pluralKey(t,locale,'app.create.moreCredits',cost-balance),{count:number(cost-balance)})}</p>
              <p className="mt-1 text-xs text-vx-fg-muted">{t("app.create.compareCredits")}</p>
              <Link href="/app/credits" className="mt-3 inline-block font-bold text-vx-accent underline underline-offset-4">{t("app.create.addCredits")}</Link>
            </div>
          )}
        </div>

        <div className="lg:col-start-1 lg:row-start-3">
          {!isShort && (
            <p className="mt-2 text-xs text-vx-fg-muted">
              {t("app.create.feedbackIntro")}{' '}
              <Link href="/app/chat?skill=prompt-writer" className="text-vx-accent underline underline-offset-2">{t("app.create.promptWriter")}</Link>,{' '}
              <Link href="/app/chat?skill=fix-my-prompt" className="text-vx-accent underline underline-offset-2">{t("app.create.fixPrompt")}</Link>,{' '}
              {t("app.create.orBrowse")}{' '}
              <Link href="/app/chat" className="text-vx-accent underline underline-offset-2">{t("app.create.allSkills")}</Link>.
            </p>
          )}
          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
              <span aria-hidden="true">✕</span>
              <span>
                {error.code === 'source_reattach_required' ? t('app.create.reattach') : tOr(t, `app.create.error.${error.code}`, ERROR_COPY[error.code] || t('app.create.error.unknown'))}
                {error.retryAfter && t('app.create.retryIn', { seconds: locale === 'en' ? error.retryAfter : Number(error.retryAfter).toLocaleString(localeTag(locale)) })}
                {error.note && ` ${error.note}`}
              </span>
            </div>
          )}
        </div>

        {/* ============ CONTROLS ============ */}
        <aside className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1 lg:row-span-3">
          {!oddlingTransfer && <CreateGoalPicker goal={goal} onChange={pickGoal} />}
          {oddlingTransfer ? (
            <section data-testid="oddling-generation-pipeline" className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-5">
              <span className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.create.oddlingPipeline')}</span>
              <h2 className="mt-2 text-lg font-extrabold text-vx-fg">{model?.name || t('app.create.checkingPrices')}</h2>
              <p className="mt-2 text-xs leading-5 text-vx-fg-muted">{t(model?.kind === 'video' ? 'app.create.oddlingMotionPipelineHelp' : model?.media?.image?.required ? 'app.create.oddlingReferencePipelineHelp' : 'app.create.oddlingPortraitPipelineHelp')}</p>
              {model && <p className="mt-3 font-vx-mono text-[11px] font-bold text-vx-money vx-num">{creditLabel(model.credits)}</p>}
              <Link href="/app/oddlings" className="mt-4 inline-flex min-h-10 items-center rounded-full border border-vx-accent/50 px-4 py-2 text-xs font-extrabold text-vx-accent hover:bg-vx-accent/10">{t('app.create.changeOddling')}</Link>
            </section>
          ) : <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="flex items-baseline justify-between mb-3">
              <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.modelHeading")}</span>
              {catalogStatus === 'live' ? (
                <span className="inline-flex items-center gap-1 font-vx-mono text-[9px] tracking-[0.12em] text-vx-accent">
                  <span aria-hidden="true">●</span>{' '}{t("app.create.livePrices")}</span>
              ) : catalogStatus === 'loading' ? (
                <span className="font-vx-mono text-[9px] tracking-[0.12em] text-vx-fg-muted">{t("app.create.checkingPrices")}</span>
              ) : (
                <span className="font-vx-mono text-[9px] tracking-[0.12em] text-vx-danger">{t("app.create.pricesUnavailable")}</span>
              )}
            </div>
            {catalogStatus !== 'live' && (
              <p role="status" className={`mb-3 rounded-lg border px-3 py-2 text-xs ${catalogStatus === 'loading' ? 'border-vx-border text-vx-fg-muted' : 'border-vx-danger/40 bg-vx-danger/[0.07] text-vx-danger'}`}>
                {catalogStatus === 'loading'
                  ? t("app.create.pricingLoading")
                  : t("app.create.pricingUnavailable")}
              </p>
            )}
            <div className="flex gap-1.5 mb-3" role="group" aria-label={t("app.create.priceTier")}>
              {TIERS.map((type) => (
                <button
                  key={type}
                  onClick={() => setTier(tier === type ? null : type)}
                  aria-pressed={tier === type}
                  className={`vx-press inline-flex min-h-10 items-center rounded-full px-3 py-1 border font-vx-mono text-[10px] tracking-[0.1em] uppercase pointer-coarse:min-h-11 ${
                    tier === type ? 'border-vx-accent text-vx-accent' : 'border-vx-fg/15 text-vx-fg-muted hover:bg-vx-fg/[0.04]'
                  }`}
                >
                  {tOr(t,`app.create.tier.${type}`,TIER_LABEL[type])}
                </button>
              ))}
            </div>
            <div data-assistant-target="create.models" data-selected-kind={model?.kind} className="scroll-mt-24">
              <div className="lg:hidden">
                <label htmlFor="studio-model" className="sr-only">{t("app.create.generationModel")}</label>
                <select
                  id="studio-model"
                  value={modelId}
                  onChange={(event) => chooseModel(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2.5 text-sm font-bold text-vx-fg focus:border-vx-accent focus:outline-hidden"
                >
                  {visibleModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.gated ? t("app.editor.workspace.preview") : freeLeftFor(freeMap, item.id) > 0 ? t("app.create.freeToday") : creditLabel(item.credits)}
                    </option>
                  ))}
                </select>
                {model && (
                  <p className="mt-2 flex items-center justify-between gap-3 text-xs text-vx-fg-muted">
                    <span className="truncate">{model.name} · {tOr(t,`public.library.${model.kind}`,model.kind)}</span>
                    <span className="shrink-0 font-vx-mono font-bold text-vx-money vx-num">{number(model.credits)} cr</span>
                  </p>
                )}
              </div>
              <div role="group" aria-label={t("pricing.col.model")} className="hidden flex-col gap-1.5 lg:flex">
                {visibleModels.map((m) => (
                  <button
                    key={m.id}
                    data-model-kind={m.kind}
                    data-requires-image={m.media?.image?.required ? 'true' : undefined}
                    onClick={() => chooseModel(m.id)}
                    aria-pressed={modelId === m.id}
                    className={`vx-press flex items-center justify-between rounded-lg px-3 py-2.5 border pointer-coarse:min-h-11 ${
                      modelId === m.id
                        ? 'border-vx-accent bg-vx-accent/[0.07]'
                        : 'border-transparent hover:bg-vx-fg/[0.04]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold truncate">{m.name}</span>
                      {m.gated && (
                        <span className="font-vx-mono text-[10px] tracking-[0.1em] text-vx-money shrink-0">{t("app.create.premium")}</span>
                      )}
                      <span className="font-vx-mono text-[10px] tracking-[0.1em] text-vx-fg-body uppercase shrink-0">{tOr(t,`public.library.${m.kind}`,m.kind)}</span>
                    </span>
                    {freeLeftFor(freeMap, m.id) > 0
                      ? <span className="font-vx-mono text-[12px] font-bold text-vx-accent shrink-0">{t(pluralKey(t,locale,'app.create.freeRemaining',freeLeftFor(freeMap,m.id)),{count:number(freeLeftFor(freeMap,m.id))})}</span>
                      : <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num shrink-0">{number(m.credits)} cr</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>}

          {model?.kind === 'video' && !fixedDurationLabel && !sourceDurationMax && (
            <ControlRow assistantTarget="create.duration" label={t("app.create.durationHeading")} options={durations} value={duration} onChange={setDuration}
              formatOption={(option) => t('presets.use.lengthCost', { length: outputDurationLabel(model, Number(option.replace('s', ''))), credits: clipCredits(model.credits, Number(option.replace('s', ''))) })} />
          )}
          {(model?.kind === 'video' || model?.kind === 'audio') && sourceDurationMax && <SourceDurationCard model={model} />}
          {(model?.kind === 'video' || model?.kind === 'audio') && fixedDurationLabel && (
            <div data-assistant-target="create.duration" tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-vx-border bg-vx-panel p-5">
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.fixedOutput")}</div>
              <div className="mt-3 font-vx-mono text-lg font-bold text-vx-fg">{fixedDurationLabel}</div>
              <p className="mt-1 text-xs text-vx-fg-muted">{t("app.create.fixedOutputHelp")}</p>
            </div>
          )}
          {model?.kind === 'audio' && audioDurationControl && (
            <div data-assistant-target="create.duration" className="scroll-mt-24 rounded-2xl border border-vx-border bg-vx-panel p-5">
              <label htmlFor="audio-duration" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.durationHeading")}</label>
              <div className="mt-3 flex items-center gap-3">
                <input id="audio-duration" aria-label={t("app.create.audioDuration")} type="number" inputMode="numeric" step="1"
                  min={audioDurationControl.min} max={audioDurationControl.max} value={audioDuration}
                  aria-invalid={invalidAudioDuration} onChange={(event) => setAudioDuration(event.target.value)}
                  className="w-28 rounded-lg border border-vx-field bg-vx-base px-3 py-2 font-vx-mono text-sm text-vx-fg" />
                <span className="text-sm text-vx-fg-muted">{t("app.create.seconds")}</span>
              </div>
              <p className={`mt-2 text-xs ${invalidAudioDuration ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>
                {invalidAudioDuration
                  ? t('app.create.durationInvalid',{min:number(audioDurationControl.min),max:number(audioDurationControl.max)})
                  : t('app.create.durationRange',{min:number(audioDurationControl.min),max:number(audioDurationControl.max),default:number(audioDurationControl.defaultValue)})}
              </p>
            </div>
          )}
          {aspectOptions.length > 0 && (
            <ControlRow assistantTarget="create.aspect" label={t("app.create.aspectHeading")} options={aspectOptions} value={aspect} onChange={setAspect} />
          )}
          {takesImageCount(model) && (
            <ControlRow assistantTarget="create.count" label={t("app.create.imagesHeading")} options={IMAGE_COUNTS} value={count} onChange={setCount} />
          )}

          {model?.kind === 'image' && !oddlingTransfer && (
            <div className="scroll-mt-24" data-assistant-target="create.character"><CharacterPanel enabled={characterOn} onToggle={setCharacterOn} picks={character} onChange={setCharacter} /></div>
          )}

          {!isShort && (
            <div className="scroll-mt-24" data-assistant-target="create.settings"><GenerationSettings model={model} seed={seed} onSeed={setSeed} negative={negative} onNegative={setNegative} /></div>
          )}

          {takesCamera && (
            <div className="scroll-mt-24" data-assistant-target="create.camera"><CameraPanel enabled={cinemaOn} onToggle={setCinemaOn} settings={cinema} onChange={setCinema} /></div>
          )}
        </aside>
      </Main>
    </div>
  );
}
