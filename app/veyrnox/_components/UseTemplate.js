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
import { modelAspectRatios, modelIdForName, presetCredits, presetHref } from '../_lib/tokens';

// The aspect the studio will actually use: the template's, when its model
// takes it (same rule as app/create), otherwise none is shown or sent.
function usableAspect(preset, model) {
  if (!preset.aspect || !model) return null;
  const options = modelAspectRatios(model);
  return options.includes(preset.aspect) ? preset.aspect : null;
}

export function UseTemplate({ preset, prompt = preset.prompt }) {
  const { t } = useI18n();
  const router = useRouter();
  const { models } = useCatalog();
  const modelId = modelIdForName(preset.model);
  const model = models.find((m) => m.id === modelId) || null;
  const aspect = usableAspect(preset, model);
  const durationOptions = model?.durations?.filter((seconds) => [5, 10].includes(seconds)) || [5, 10];
  const [durationSeconds, setDurationSeconds] = useState(preset.durationSeconds || 10);
  const [targetSeconds, setTargetSeconds] = useState(60);
  const credits = presetCredits(preset, models, durationSeconds);
  const [handoffError, setHandoffError] = useState('');

  function use() {
    // The URL restores the recipe if storage is blocked; preserve edited text.
    if (modelId) {
      let saved = false;
      try { saved = writeStudioDraft(window.sessionStorage, { prompt, model: modelId, aspect, durationSeconds, negativePrompt: preset.negativePrompt, templateId: preset.id }); } catch { /* The unedited URL recipe still works. */ }
      if (!saved && prompt !== preset.prompt) { setHandoffError('studio'); return; }
    }
    router.push(presetHref(preset, durationSeconds));
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
        {aspect && <div><dt className="text-vx-fg-muted">{t("presets.use.aspect")}</dt><dd className="font-vx-mono text-[22px] font-bold">{aspect}</dd></div>}
        {preset.durationSeconds && <div><dt className="text-vx-fg-muted">{t("presets.use.clip")}</dt><dd><select aria-label={t("presets.use.clipLength")} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} className="mt-1 rounded-lg border border-vx-border bg-vx-panel px-3 py-2 font-vx-mono text-[16px] font-bold">{durationOptions.map((seconds) => <option key={seconds} value={seconds}>{t('presets.use.seconds', { count: seconds })}</option>)}</select></dd></div>}
      </dl>
      <button
        type="button"
        onClick={use}
        disabled={!prompt.trim()}
        className="vx-press mt-6 inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-50"
      >
        <span>{preset.inspired ? t("presets.use.similar") : t("presets.use.template")}</span>
        <span className="font-vx-mono vx-num text-[15px] font-bold">{credits} cr</span>
      </button>
      <div className="mt-6 rounded-xl border border-vx-border bg-vx-panel/40 p-4">
        <p className="font-bold">{t("presets.use.longer")}</p>
        <p className="mt-1 text-[13px] text-vx-fg-muted">{t("presets.use.filmPlan")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label={t("presets.use.target")} value={targetSeconds} onChange={(event) => setTargetSeconds(Number(event.target.value))} className="rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm font-bold">
            {[30, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{t('presets.use.seconds', { count: seconds })}</option>)}
          </select>
          <button type="button" onClick={buildFilm} disabled={!prompt.trim()} className="vx-press rounded-full border border-vx-accent px-5 py-2 text-sm font-extrabold text-vx-accent disabled:opacity-50">{t("presets.use.build")}</button>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-vx-border bg-vx-panel/40 p-4">
        <p className="font-bold">{t("presets.use.chatTitle")}</p>
        <p className="mt-1 text-[13px] text-vx-fg-muted">{t("presets.use.chatPlan")}</p>
        <Link href="/app/chat?skill=prompt-writer" onClick={handToChat} className="vx-press mt-3 inline-flex rounded-full border border-vx-accent px-5 py-2 text-sm font-extrabold text-vx-accent">
          {t("presets.use.openChat")}
        </Link>
      </div>
      <p className="mt-3 text-[13px] text-vx-fg-muted">{t("presets.use.refunds")}</p>
      {handoffError === 'studio' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{rich(t('presets.use.handoff'), { studio: <a href={presetHref(preset, durationSeconds)} className="underline">{t('presets.use.openStudio')}</a> })}</p>}
      {handoffError === 'chat' && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{rich(t('presets.use.chatHandoff'), { chat: <a href="/app/chat?skill=prompt-writer" className="underline">{t('label.LLM Chat')}</a> })}</p>}
    </div>
  );
}
