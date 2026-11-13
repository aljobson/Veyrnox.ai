'use client';
import { templatePhotoHints, templatePhotosUnavailable, templateContract, templatePhotoError, templateBoundPrompt, fidelityTemplateId, fidelityBlocked } from '../../../lib/templateClientContract';
import { TemplatePhotoSlots } from './TemplatePhotoSlots';
import { rich } from '../../../lib/i18n/rich';
import { useI18n } from '../../../components/I18nProvider.jsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { writeTemplateChatDraft } from '../_lib/chatTemplateDraft';
import { useCatalog } from '../_lib/useCatalog';
import { writeFilmStarter } from '../_lib/filmTemplateDraft';
import { writeStudioDraft } from '../_lib/landingDraft';
import { clearTemplateMediaHandoff, TEMPLATE_IMAGE_ACCEPT, templateImageFileError, writeTemplateMediaHandoff } from '../_lib/templateMediaHandoff';
import { prepareUpload } from '../_lib/uploadConvert.mjs';
import { TEMPLATE_PROMPT_MAX, templateModelEligible, createPromptModelAvailable } from '../_lib/templateDraft';
import { clipCredits, modelAspectRatios, templateModelId, presetCredits, presetHref } from '../_lib/tokens';
import { CHAT_USER_TEXT_MAX } from '../../../lib/chatLimits.js';
import { Spinner } from './Spinner';
import { TemplateGenerate } from './TemplateGenerate';
import { inlineBlockReason, templateInputs } from '../_lib/templateGenerate';
import { imageTemplateNeedsPhoto, imageTemplateModelAvailable } from '../_lib/imageTemplateModels.js';
import { nearestOption } from '../../../lib/aspectShapes.mjs';

export function UseTemplate({ preset, prompt = preset.prompt, generationBlocked: sourceGenerationBlocked = false, templateClip = null }) {
  const { t } = useI18n();
  const router = useRouter();
  const { models, live } = useCatalog();
  const imagePhotoRequired = imageTemplateNeedsPhoto(preset);
  const originalId = templateClip ? templateClip.model : templateModelId(preset);
  const catalogModel = models.find((m) => m.id === originalId) || null;
  const original = templateClip && catalogModel ? { ...catalogModel, credits: templateClip.credits, durations: [5], media: { image: { ...catalogModel.media?.image, required: true, maxFiles: 1 } } } : catalogModel;
  const modelOptions = original && (!imagePhotoRequired || live) && imageTemplateModelAvailable(preset, original) && !original.gated && !original.premium && createPromptModelAvailable(original)
    ? [original, ...(!templateClip && live ? models.filter((m) => m.id !== originalId && templateModelEligible(m, original) && imageTemplateModelAvailable(preset, m)) : [])] : [];
  const [pickedModel, setPickedModel] = useState(originalId);
  const model = modelOptions.find((m) => m.id === pickedModel) || modelOptions[0] || null;
  const modelId = model?.id;
  const aspectOptions = templateClip ? [] : modelAspectRatios(model);
  const [pickedAspect, setPickedAspect] = useState(preset.aspect);
  const aspect = nearestOption(pickedAspect || preset.clip?.aspectRatio || preset.previewAspect, aspectOptions) || aspectOptions[0] || null;
  const isVideo = model ? model.kind === 'video' : Boolean(preset.durationSeconds);
  const durationOptions = model?.durations?.length ? model.durations : [5, 10];
  const [pickedSeconds, setDurationSeconds] = useState(preset.durationSeconds || 5);
  const durationSeconds = templateClip ? 5 : isVideo ? (durationOptions.includes(pickedSeconds) ? pickedSeconds : durationOptions[0]) : undefined;
  const [targetSeconds, setTargetSeconds] = useState(60);
  const costFor = (seconds) => model ? (isVideo ? clipCredits(model.credits, seconds) : model.credits) : presetCredits(preset, models, seconds);
  const credits = costFor(durationSeconds);
  const href = presetHref(preset, durationSeconds, { model: modelId, aspect, templateClip });
  function pickModel(id) {
    setPickedModel(id);
    setPickedAspect(preset.aspect);
    setDurationSeconds(preset.durationSeconds || 5);
  }
  const [handoffError, setHandoffError] = useState('');
  const [opening, setOpening] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [singlePhotoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photos, setPhotos] = useState(() => photo ? [photo] : []);
  const [slotBusy, setSlotBusy] = useState({});
  const photoSequence = useRef(0);
  // A server-held template clip has its own gate; the template_id fidelity contract does not apply to it.
  const contract = templateClip ? null : templateContract(preset);
  const boundCount = contract?.class === 'bound' ? contract.slotCount : 0;
  const boundReady = !boundCount || Array.from({ length: boundCount }, (_, i) => photos[i]).every(Boolean);
  const photoBusy = singlePhotoBusy || Object.values(slotBusy).some(Boolean);
  const auditedTemplateId = model && contract ? fidelityTemplateId(contract, templateBoundPrompt(contract, prompt, model.id, boundCount || 1), model.id, templateInputs(preset, model, { prompt, aspect, durationSeconds, aspectOptions })) : undefined;
  const promptBlocked = !templateClip && (!prompt.trim() || prompt.length > TEMPLATE_PROMPT_MAX);
  const photosUnavailable = contract?.class === 'bound' && (!live || templatePhotosUnavailable(contract, model?.media));
  const generationBlocked = photosUnavailable || sourceGenerationBlocked || (live && fidelityBlocked(contract, prompt));
  const generationDisabled = (imagePhotoRequired && !photo) || generationBlocked || promptBlocked || !model || photoBusy || !boundReady;
  const chatBlocked = !prompt.trim() || prompt.length > CHAT_USER_TEXT_MAX;
  const requiredImage = imagePhotoRequired || model?.media?.image?.required === true;
  // Photo image recipes continue to Create with the existing handoff; video inline generation stays unchanged.
  const inline = !imagePhotoRequired && inlineBlockReason(preset, model, { photo: true }) === null;

  async function choosePhoto(file) {
    const sequence = ++photoSequence.current;
    setPhotoError('');
    if (!file) {
      setPhoto(null);
      setPhotoBusy(false);
      setHandoffError('');
      return;
    }
    const problem = templateImageFileError(file);
    if (problem) {
      setPhoto(null);
      setHandoffError('mediaFile');
      return;
    }
    setPhoto(null);
    setPhotoBusy(true);
    setHandoffError('');
    try {
      const ready = await prepareUpload(file);
      if (photoSequence.current !== sequence) return;
      if (templateImageFileError(ready)) { setHandoffError('mediaFile'); return; }
      if (auditedTemplateId) {
        let bitmap;
        let dimensionError;
        try {
          bitmap = await createImageBitmap(ready);
          dimensionError = templatePhotoError(contract, bitmap.width, bitmap.height);
        } catch { /* Unknown dimensions: let server media inspection decide. */ }
        finally { bitmap?.close(); }
        if (photoSequence.current !== sequence) return;
        if (dimensionError) { setPhotoError(dimensionError); return; }
      }
      setPhoto(ready);
    } catch {
      if (photoSequence.current === sequence) setHandoffError('mediaFile');
    } finally {
      if (photoSequence.current === sequence) setPhotoBusy(false);
    }
  }

  function use() {
    if (generationDisabled) return;
    // The URL restores the recipe if storage is blocked; preserve edited text.
    if (modelId) {
      let saved = false;
      try { saved = writeStudioDraft(window.sessionStorage, { prompt, model: modelId, aspect, durationSeconds, negativePrompt: preset.negativePrompt, templateId: preset.id }); } catch { /* The unedited URL recipe still works. */ }
      if (!saved && prompt !== preset.prompt) { setHandoffError('studio'); return; }
    }
    if (!clearTemplateMediaHandoff(window)
      || (boundCount ? !writeTemplateMediaHandoff(window, { templateId: preset.id, modelId, images: photos }) : requiredImage && photo && !writeTemplateMediaHandoff(window, { templateId: preset.id, modelId, image: photo }))) {
      setHandoffError('media');
      return;
    }
    setOpening(true);
    router.push(href);
  }

  function buildFilm() {
    try {
      if (!writeFilmStarter(window.sessionStorage, preset, prompt, targetSeconds)) throw new Error('not saved');
      router.push('/app/film-studio');
    } catch {
      setHandoffError('studio');
    }
  }

  function handToChat(event) {
    if (chatBlocked) {
      event.preventDefault();
      if (prompt.length > CHAT_USER_TEXT_MAX) setHandoffError('chatLimit');
      return;
    }
    let saved = false;
    try { saved = writeTemplateChatDraft(window.sessionStorage, preset, prompt); } catch { /* Browser storage can be unavailable. */ }
    if (saved) return;
    event.preventDefault();
    setHandoffError('chat');
  }

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 gap-3 text-[14px]">
        <div><dt className="text-vx-fg-muted">{t("presets.use.cost")}</dt><dd className="font-vx-mono vx-num text-[22px] font-bold text-vx-money">{credits == null ? "—" : `${credits} cr`}</dd></div>
        {modelOptions.length > 1 && <div className="col-span-2"><dt className="text-vx-fg-muted">{t("label.Models")}</dt><dd><select aria-label={t("label.Model picker")} value={modelId} onChange={(event) => pickModel(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-bold focus-visible:outline-2 focus-visible:outline-vx-accent">{modelOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></dd></div>}
        {aspectOptions.length > 0 && <div><dt className="text-vx-fg-muted">{t("presets.use.aspect")}</dt><dd><select aria-label={t("presets.use.aspect")} value={aspect} onChange={(event) => setPickedAspect(event.target.value)} className="mt-1 min-h-11 max-w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-vx-mono font-bold focus-visible:outline-2 focus-visible:outline-vx-accent">{aspectOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></dd></div>}
        {isVideo && <div><dt className="text-vx-fg-muted">{t("presets.use.clip")}</dt><dd><select aria-label={t("presets.use.clipLength")} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} className="mt-1 min-h-11 max-w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-vx-mono font-bold focus-visible:outline-2 focus-visible:outline-vx-accent">{durationOptions.map((seconds) => <option key={seconds} value={seconds}>{t('presets.use.lengthCost', { length: t('presets.use.seconds', { count: seconds }), credits: costFor(seconds) })}</option>)}</select></dd></div>}
      </dl>
      {boundCount > 0 && !photosUnavailable && <TemplatePhotoSlots key={preset.id} count={boundCount} hints={templatePhotoHints(contract)} files={photos} onChange={(index, file) => setPhotos(previous => Array.from({ length: boundCount }, (_, i) => i === index ? file : previous[i] || null))} onBusy={(index, busy) => setSlotBusy(previous => ({ ...previous, [index]: busy }))} />}
      {requiredImage && !boundCount && (
        <fieldset className="mt-5 rounded-xl border border-vx-border bg-vx-panel/40 p-4">
          <legend className="px-1 text-sm font-bold">{t('presets.use.photoTitle')}</legend>
          <p className="mt-1 text-[13px] leading-5 text-vx-fg-muted">{t('presets.use.photoPrivacy')}</p>
          {templateClip && <p role="note" className="mt-2 text-xs text-vx-fg-muted">{t('app.create.referenceLikenessNotice')}</p>}
          <div className="mt-3 flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-vx-border bg-vx-base p-2.5">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-vx-panel font-vx-mono text-sm text-vx-accent">{photoBusy ? '…' : photo ? '✓' : '+'}</span>
            <span role={photoBusy ? 'status' : undefined} className="min-w-0 flex-1 truncate text-xs text-vx-fg-muted">{photoBusy ? t('presets.use.photoPreparing') : photo?.name || t('presets.use.photoHint')}</span>
            <label className="vx-press relative inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border border-vx-accent px-4 text-xs font-extrabold text-vx-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-vx-accent">
              {photo ? t('presets.use.photoReplace') : t('presets.use.photoChoose')}
              <input type="file" accept={TEMPLATE_IMAGE_ACCEPT} disabled={photoBusy} aria-label={t('presets.use.photoChoose')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={(event) => { const file = event.target.files?.[0] || null; event.target.value = ''; return choosePhoto(file); }} />
            </label>
            {photo && <button type="button" onClick={() => choosePhoto(null)} aria-label={t('presets.use.photoRemove')} className="vx-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-vx-fg-muted hover:text-vx-fg">×</button>}
          </div>
        </fieldset>
      )}
      {imagePhotoRequired && !photo && <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t('presets.use.photoRequired')}</p>}
      {imagePhotoRequired && !model && <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t('presets.fidelity.blocked')}</p>}
      {model && pickedModel !== originalId && <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t('presets.fidelity.modelSwitch')}</p>}
      {(preset.kind !== 'image' && live && model && !generationBlocked && !auditedTemplateId) && <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t('presets.fidelity.previewNotice')}</p>}
      {photo && contract && !boundCount && <p className="mt-3 text-sm text-vx-fg-muted">{t(contract.photoGuidance)}</p>}
      {generationBlocked && !sourceGenerationBlocked && <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t(photosUnavailable ? 'presets.fidelity.photosUnavailable' : 'public.TemplateRecipe.sourceVideoUnsupported')}</p>}
      {photoError && <p role="alert" className="mt-3 text-sm text-vx-danger">{t(photoError)}</p>}
      {inline && !(generationBlocked || promptBlocked || !model) && (
        <TemplateGenerate preset={preset} model={model} prompt={prompt} aspect={aspect} aspectOptions={aspectOptions} durationSeconds={durationSeconds} unitCost={credits} photo={requiredImage ? photo : null} photos={boundCount ? photos : undefined} requiredCount={boundCount} preparing={photoBusy} needsPhoto={requiredImage} templateClip={templateClip} />
      )}
      {!templateClip && <button
        type="button"
        onClick={use}
        disabled={generationDisabled || opening}
        aria-busy={opening || undefined}
        className={`${inline ? 'vx-press mt-6 ms-3 inline-flex items-center gap-4 rounded-full border border-vx-accent px-6 py-3.5 font-extrabold text-vx-accent hover:bg-vx-accent/10' : 'vx-press mt-6 inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover'} ${opening ? 'cursor-wait' : 'disabled:opacity-50'}`}
      >
        <span>{inline ? t('presets.use.editBeforeGenerating') : requiredImage && photo ? t('presets.use.withPhoto') : preset.inspired ? t("presets.use.similar") : t("presets.use.template")}</span>
        {opening
          ? <span className="grid w-[3.5ch] place-items-center"><Spinner size={18} /></span>
          : <span className="font-vx-mono vx-num text-[15px] font-bold">{credits == null ? "—" : `${credits} cr`}</span>}
      </button>}
      {!templateClip && isVideo && <div className="mt-6 rounded-xl border border-vx-border bg-vx-panel/40 p-4">
        <p className="font-bold">{t("presets.use.longer")}</p>
        <p className="mt-1 text-[13px] text-vx-fg-muted">{t("presets.use.filmPlan")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label={t("presets.use.target")} value={targetSeconds} onChange={(event) => setTargetSeconds(Number(event.target.value))} className="rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm font-bold">
            {[30, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{t('presets.use.seconds', { count: seconds })}</option>)}
          </select>
          <button type="button" onClick={buildFilm} disabled={generationDisabled} className="vx-press rounded-full border border-vx-accent px-5 py-2 text-sm font-extrabold text-vx-accent disabled:opacity-50">{t("presets.use.build")}</button>
        </div>
      </div>}
      <div className="mt-3 rounded-xl border border-vx-border bg-vx-panel/40 p-4">
        <p className="font-bold">{t("presets.use.chatTitle")}</p>
        <p className="mt-1 text-[13px] text-vx-fg-muted">{t("presets.use.chatPlan")}</p>
        <Link href="/app/chat?skill=prompt-writer" onClick={handToChat} aria-disabled={chatBlocked} className="vx-press mt-3 inline-flex aria-disabled:opacity-50 rounded-full border border-vx-accent px-5 py-2 text-sm font-extrabold text-vx-accent">
          {t("presets.use.openChat")}
        </Link>
      </div>
      <p className="mt-3 text-[13px] text-vx-fg-muted">{t("presets.use.refunds")}</p>
      {handoffError === 'studio' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{rich(t('presets.use.handoff'), { studio: <a href={href} className="underline">{t('presets.use.openStudio')}</a> })}</p>}
      {handoffError === 'chat' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{rich(t('presets.use.chatHandoff'), { chat: <a href="/app/chat?skill=prompt-writer" className="underline">{t('label.LLM Chat')}</a> })}</p>}
      {handoffError === 'chatLimit' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{t('public.TemplateRecipe.chatMessageTooLong', { count: prompt.length, max: CHAT_USER_TEXT_MAX })}</p>}
      {handoffError === 'mediaFile' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{t('presets.use.photoInvalid')}</p>}
      {handoffError === 'media' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{t('presets.use.photoHandoff')}</p>}
    </div>
  );
}
