'use client';
import { rich } from '../../../lib/i18n/rich';
import { useI18n } from '../../../components/I18nProvider.jsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { writeTemplateChatDraft } from '../_lib/chatTemplateDraft';
import { useCatalog } from '../_lib/useCatalog';
import { writeFilmStarter } from '../_lib/filmTemplateDraft';
import { writeStudioDraft } from '../_lib/landingDraft';
import { TEMPLATE_PROMPT_MAX, templateModelEligible, createPromptModelAvailable } from '../_lib/templateDraft';
import { clipCredits, modelAspectRatios, modelIdForName, presetCredits, presetHref } from '../_lib/tokens';
import { CHAT_USER_TEXT_MAX } from '../../../lib/chatLimits.js';
import { Spinner } from './Spinner';
import { nearestOption } from '../../../lib/aspectShapes.mjs';

export function UseTemplate({ preset, prompt = preset.prompt, generationBlocked = false }) {
  const { t } = useI18n();
  const router = useRouter();
  const { models, live } = useCatalog();
  const originalId = modelIdForName(preset.model);
  const original = models.find((m) => m.id === originalId) || null;
  const modelOptions = original && !original.gated && !original.premium && createPromptModelAvailable(original)
    ? [original, ...(live ? models.filter((m) => m.id !== originalId && templateModelEligible(m, original)) : [])] : [];
  const [pickedModel, setPickedModel] = useState(originalId);
  const model = modelOptions.find((m) => m.id === pickedModel) || modelOptions[0] || null;
  const modelId = model?.id;
  const aspectOptions = modelAspectRatios(model);
  const [pickedAspect, setPickedAspect] = useState(preset.aspect);
  const aspect = nearestOption(pickedAspect || preset.clip?.aspectRatio || preset.previewAspect, aspectOptions) || aspectOptions[0] || null;
  const isVideo = model ? model.kind === 'video' : Boolean(preset.durationSeconds);
  const durationOptions = model?.durations?.length ? model.durations : [5, 10];
  const [pickedSeconds, setDurationSeconds] = useState(preset.durationSeconds || 5);
  const durationSeconds = isVideo ? (durationOptions.includes(pickedSeconds) ? pickedSeconds : durationOptions[0]) : undefined;
  const [targetSeconds, setTargetSeconds] = useState(60);
  const costFor = (seconds) => model ? (isVideo ? clipCredits(model.credits, seconds) : model.credits) : presetCredits(preset, models, seconds);
  const credits = costFor(durationSeconds);
  const href = presetHref(preset, durationSeconds, { model: modelId, aspect });
  function pickModel(id) {
    setPickedModel(id);
    setPickedAspect(preset.aspect);
    setDurationSeconds(preset.durationSeconds || 5);
  }
  const [handoffError, setHandoffError] = useState('');
  const [opening, setOpening] = useState(false);
  const promptBlocked = !prompt.trim() || prompt.length > TEMPLATE_PROMPT_MAX;
  const generationDisabled = generationBlocked || promptBlocked || !model;
  const chatBlocked = !prompt.trim() || prompt.length > CHAT_USER_TEXT_MAX;

  function use() {
    // The URL restores the recipe if storage is blocked; preserve edited text.
    if (modelId) {
      let saved = false;
      try { saved = writeStudioDraft(window.sessionStorage, { prompt, model: modelId, aspect, durationSeconds, negativePrompt: preset.negativePrompt, templateId: preset.id }); } catch { /* The unedited URL recipe still works. */ }
      if (!saved && prompt !== preset.prompt) { setHandoffError('studio'); return; }
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
        <div><dt className="text-vx-fg-muted">{t("presets.use.cost")}</dt><dd className="font-vx-mono vx-num text-[22px] font-bold text-vx-money">{credits} cr</dd></div>
        {modelOptions.length > 1 && <div className="col-span-2"><dt className="text-vx-fg-muted">{t("label.Models")}</dt><dd><select aria-label={t("label.Model picker")} value={modelId} onChange={(event) => pickModel(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-bold focus-visible:outline-2 focus-visible:outline-vx-accent">{modelOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></dd></div>}
        {aspectOptions.length > 0 && <div><dt className="text-vx-fg-muted">{t("presets.use.aspect")}</dt><dd><select aria-label={t("presets.use.aspect")} value={aspect} onChange={(event) => setPickedAspect(event.target.value)} className="mt-1 min-h-11 max-w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-vx-mono font-bold focus-visible:outline-2 focus-visible:outline-vx-accent">{aspectOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></dd></div>}
        {isVideo && <div><dt className="text-vx-fg-muted">{t("presets.use.clip")}</dt><dd><select aria-label={t("presets.use.clipLength")} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} className="mt-1 min-h-11 max-w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-vx-mono font-bold focus-visible:outline-2 focus-visible:outline-vx-accent">{durationOptions.map((seconds) => <option key={seconds} value={seconds}>{t('presets.use.lengthCost', { length: t('presets.use.seconds', { count: seconds }), credits: costFor(seconds) })}</option>)}</select></dd></div>}
      </dl>
      <button
        type="button"
        onClick={use}
        disabled={generationDisabled || opening}
        aria-busy={opening || undefined}
        className={`vx-press mt-6 inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover ${opening ? 'cursor-wait' : 'disabled:opacity-50'}`}
      >
        <span>{preset.inspired ? t("presets.use.similar") : t("presets.use.template")}</span>
        {opening
          ? <span className="grid w-[3.5ch] place-items-center"><Spinner size={18} /></span>
          : <span className="font-vx-mono vx-num text-[15px] font-bold">{credits} cr</span>}
      </button>
      <div className="mt-6 rounded-xl border border-vx-border bg-vx-panel/40 p-4">
        <p className="font-bold">{t("presets.use.longer")}</p>
        <p className="mt-1 text-[13px] text-vx-fg-muted">{t("presets.use.filmPlan")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label={t("presets.use.target")} value={targetSeconds} onChange={(event) => setTargetSeconds(Number(event.target.value))} className="rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm font-bold">
            {[30, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{t('presets.use.seconds', { count: seconds })}</option>)}
          </select>
          <button type="button" onClick={buildFilm} disabled={generationDisabled} className="vx-press rounded-full border border-vx-accent px-5 py-2 text-sm font-extrabold text-vx-accent disabled:opacity-50">{t("presets.use.build")}</button>
        </div>
      </div>
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
    </div>
  );
}
