'use client';
import { generationSourceState, sourceList, publicSlotMax, editSlotSource, moveSlotSource } from '../../../../lib/generationSourceSlots.mjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GatewayError, gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';
import { planAttachments } from '../../../../lib/createAttach.mjs';
import { prepareUploads, needsConversion } from '../../_lib/uploadConvert.mjs';
import { pushJobHistory } from '../../_lib/jobHistory';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { useFreeAllowance } from '../../_lib/useFreeAllowance';
import { freeCost, freeLeftFor } from '../../_lib/freeAllowance';
import { batchNote, inputsForIndex, sendInOrder, submitErrorCode } from '../../_lib/imageBatch';
import { audioDurationConfig, audioDurationIsInvalid, settingsInputs, voiceIsMissing } from '../../_lib/generationSettings';
import {
  COMPOSER_KINDS,
  chatMediaModels,
  firstOpenMediaModel,
  mediaGenerationCount,
  mediaGenerationSources,
  mediaOutputSettings,
  mediaPromptIsMissing,
  supportedAspect,
  supportedDuration,
} from '../../_lib/chatMedia';

const LOCAL_SOURCE_CODES = ['source_reattach_required', 'source_count_exceeded']; // refused here, before anything is sent
const errorFor = (error) => error instanceof GatewayError || LOCAL_SOURCE_CODES.includes(error?.code)
  ? { code: submitErrorCode(error.code), retryAfter: error.retryAfter }
  : { code: 'outcome_unknown' };

export function useChatMediaGeneration({ kind, models, catalogLive }) {
  const enabled = kind !== COMPOSER_KINDS.CHAT;
  const freeMap = useFreeAllowance();
  const [modelIds, setModelIds] = useState({});
  const [durationWanted, setDuration] = useState(5);
  const [audioDurations, setAudioDurations] = useState({});
  const [aspectWanted, setAspect] = useState('16:9');
  const [countWanted, setCount] = useState(1);
  const [resolutionWanted, setResolution] = useState(null);
  const [audioWanted, setAudio] = useState(null);
  const [voice, setVoice] = useState('');
  const [sources, setSources] = useState({});
  const [libraryFor, setLibraryFor] = useState(null);
  const [consent, setConsent] = useState(false);
  const [attachNotice, setAttachNotice] = useState(null);
  const attachSeq = useRef(0);
  const [attachConverting, setAttachConverting] = useState(false);
  const [sourcesConverting, setSourcesConverting] = useState(false);
  const converting = attachConverting || sourcesConverting;
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const [jobKind, setJobKind] = useState(null);
  const [sending, setSending] = useState(false);
  const sourceRef = useRef(sources);
  const inFlight = useRef(false);

  const availableModels = useMemo(() => chatMediaModels(models, kind), [models, kind]);
  const model = availableModels.find((item) => item.id === modelIds[kind]) || firstOpenMediaModel(models, kind);
  const latestAttach = useRef(null);
  useEffect(() => { latestAttach.current = { availableModels, model }; });
  const duration = supportedDuration(model, durationWanted);
  const audioDurationControl = audioDurationConfig(model);
  const audioDuration = audioDurationControl
    ? audioDurations[model.id] ?? String(audioDurationControl.defaultValue)
    : '';
  const invalidAudioDuration = audioDurationIsInvalid(model, audioDuration);
  const aspect = supportedAspect(model, aspectWanted);
  const count = mediaGenerationCount(model, countWanted);
  const outputSettings = mediaOutputSettings(model, resolutionWanted, audioWanted);
  const unitCost = model ? model.credits * (model.kind === COMPOSER_KINDS.VIDEO ? Math.ceil(duration / 5) : 1) : 0;
  const freeLeft = freeLeftFor(freeMap, model?.id);
  const cost = freeLeft > 0 ? freeCost(unitCost, count, freeLeft) : unitCost * count;
  const media = model?.media || {};
  const { missingSource, needsReattach, overLimit, hasSource: hasSource } = generationSourceState(media, sources);
  const missingConsent = hasSource && !consent;
  const missingVoice = voiceIsMissing(model, voice);
  const onUnreachable = useCallback(() => setError({ code: 'poll_unreachable' }), []);
  const { jobs, generating, startJobs, addJob, clearJobs: clearStudioJobs } = useStudioJobs({ onUnreachable });

  function setAudioDuration(value) {
    if (!model?.id) return;
    setAudioDurations((previous) => ({ ...previous, [model.id]: value }));
  }

  const clearJobs = useCallback(() => {
    clearStudioJobs();
    setJobKind(null);
  }, [clearStudioJobs]);

  const clearSources = useCallback(() => {
    setSources((previous) => {
      Object.values(previous).flatMap(sourceList).forEach((source) => source?.file && URL.revokeObjectURL(source.previewUrl));
      return {};
    });
    setLibraryFor(null);
    setConsent(false);
  }, []);

  useEffect(() => { sourceRef.current = sources; }, [sources]);

  useEffect(() => () => {
    Object.values(sourceRef.current).flatMap(sourceList).forEach((source) => source?.file && URL.revokeObjectURL(source.previewUrl));
  }, []);

  const loadBalance = useCallback(async () => {
    if (!enabled) return;
    try { setBalance((await gatewayFetch('/balance')).balance); } catch { setBalance(null); }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const initial = window.setTimeout(loadBalance, 0);
    window.addEventListener('focus', loadBalance);
    window.addEventListener('veyrnox:balance-changed', loadBalance);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener('focus', loadBalance);
      window.removeEventListener('veyrnox:balance-changed', loadBalance);
    };
  }, [enabled, loadBalance]);

  const selectModel = useCallback((id) => {
    setModelIds((previous) => ({ ...previous, [kind]: id }));
    clearSources();
    setError(null);
    setVoice('');
    setResolution(null);
    setAudio(null);
  }, [kind, clearSources]);

  function pickSource(slot, file, asset = null, index) {
    setSources(previous => {
      const old = sourceList(previous[slot]);
      const removed = index !== undefined ? old[index] : publicSlotMax(media[slot]) === 1 || (!file && !asset) ? old : [];
      for (const item of sourceList(removed)) if (item?.file) URL.revokeObjectURL(item.previewUrl);
      const source = file ? { file, previewUrl: URL.createObjectURL(file) } : asset ? { assetId: asset.id, previewUrl: asset.url, label: asset.label } : null;
      return editSlotSource(previous, slot, source, index, publicSlotMax(media[slot]));
    });
    setConsent(false);
  }

  // The paperclip shown for every model: the files' types pick the slots, and the model
  // switches to this composer's one that takes the most of them. The notice is codes
  // ('unsupported'; 'switched' with the model's name; 'unused' with a count) for the composer to word.
  // HEIC, AVIF, GIF, MOV and WebM are converted first ('converting'; 'failed' carries the first failure's code).
  // A newer attach supersedes one still converting; the plan uses the composer as it is when conversion ends.
  async function attachFromDevice(fileList) {
    const seq = ++attachSeq.current;
    const picked = Array.from(fileList || []);
    if (picked.some(needsConversion)) { setAttachNotice({ converting: true }); setAttachConverting(true); }
    let prepared;
    try { prepared = await prepareUploads(picked); } finally { if (attachSeq.current === seq) setAttachConverting(false); }
    if (attachSeq.current !== seq) return;
    const { files, failed } = prepared;
    const { availableModels: currentModels, model: currentModel } = latestAttach.current;
    const plan = planAttachments(currentModels.filter((item) => !item.gated), currentModel, files);
    if (!plan) { setAttachNotice(failed.length ? { failed: failed[0].code } : { unsupported: true }); return; }
    const switched = plan.model.id !== currentModel?.id;
    setAttachNotice({ switched: switched ? plan.model.name : null, unused: plan.unused.length, failed: failed[0]?.code || null });
    if (switched) selectModel(plan.model.id);
    else clearSources();
    const positions = {};
    for (const { slot, file } of plan.assignments) pickSource(slot, file, null, (positions[slot] = (positions[slot] || 0) + 1) - 1);
  }

  async function uploadSource(file) {
    const upload = await gatewayFetch('/uploads', {
      method: 'POST',
      body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
    });
    let response;
    try {
      response = await fetch(upload.upload_url, { method: 'PUT', headers: upload.headers || { 'Content-Type': upload.content_type }, body: file });
    } catch {
      throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' });
    }
    if (!response.ok) throw new GatewayError('upload_failed', { status: response.status, code: 'upload_failed' });
    return upload.key;
  }

  async function generate(prompt) {
    if (converting) return false; // a picked file is still being converted
    if (needsReattach) { setError({ code: 'source_reattach_required' }); return false; }
    if (overLimit) { setError({ code: 'source_count_exceeded' }); return false; }
    const cleanPrompt = String(prompt || '').trim();
    if (inFlight.current || sending || generating || !catalogLive || !model || model.gated || mediaPromptIsMissing(model, cleanPrompt) || balance == null
      || cost > balance || missingSource || missingConsent || missingVoice || invalidAudioDuration) return false;
    inFlight.current = true;
    setSending(true);
    setError(null);
    const inputs = {
      ...(model.takesPrompt !== false ? { prompt: cleanPrompt } : {}),
      aspect_ratio: aspect || undefined,
      duration_seconds: model.kind === COMPOSER_KINDS.VIDEO ? duration : undefined,
      ...settingsInputs(model, { seed: '', negative: '', voice, duration: audioDuration }),
      ...outputSettings,
    };
    Object.keys(inputs).forEach((key) => inputs[key] === undefined && delete inputs[key]);

    try {
      const { references, source_keys: sourceKeys, source_assets: sourceAssets } = await mediaGenerationSources(model, sources, uploadSource);
      const anySource = sourceKeys.length + sourceAssets.length > 0;
      const { started, error: failure } = await sendInOrder(count, async (index) => {
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: model.id,
            idempotency_key: makeIdempotencyKey(),
            inputs: inputsForIndex(inputs, index, count),
            references,
            consent: anySource ? true : undefined,
          }),
        });
        const jobCredits = submitted.free_allowance === true ? 0 : unitCost;
        const job = { job_id: submitted.job_id, state: 'queued', credits: jobCredits, model_id: model.id };
        if (index === 0) {
          setJobKind(model.kind);
          startJobs(job);
        } else addJob(job);
        pushJobHistory({
          job_id: submitted.job_id,
          model_id: model.id,
          credits: jobCredits,
          prompt: cleanPrompt.slice(0, 60),
          name: cleanPrompt.slice(0, 40),
        });
        if (submitted.balance_after != null) setBalance(submitted.balance_after);
      });
      if (started > 0) notifyBalanceChanged();
      if (failure) {
        const nextError = errorFor(failure);
        setError({ ...nextError, note: batchNote(started, count, nextError.code) });
      }
      return started > 0;
    } catch (failure) {
      setError(errorFor(failure));
      return false;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return {
    enabled,
    availableModels,
    model,
    selectModel,
    duration,
    setDuration,
    audioDuration,
    setAudioDuration,
    audioDurationControl,
    invalidAudioDuration,
    aspect,
    setAspect,
    count,
    setCount,
    resolution: outputSettings.output_resolution,
    setResolution,
    audio: outputSettings.audio_enabled,
    setAudio,
    voice,
    setVoice,
    sources,
    media,
    pickSource,
    reorderSources: (slot, from, to) => { setConsent(false); setSources(prev => moveSlotSource(prev, slot, from, to)); },
    attachFromDevice,
    attachNotice,
    converting,
    setSourcesConverting,
    libraryFor,
    setLibraryFor,
    consent,
    setConsent,
    balance,
    cost,
    freeLeft,
    error,
    setError,
    jobs,
    jobKind,
    generating,
    sending,
    clearJobs,
    missingSource,
    missingConsent,
    missingVoice,
    generate,
    catalogLive,
  };
}
