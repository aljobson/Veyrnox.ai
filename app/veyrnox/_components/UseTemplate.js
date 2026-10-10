'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCatalog } from '../_lib/useCatalog';
import { writeStudioDraft } from '../_lib/landingDraft';
import { ASPECT_RATIOS, modelIdForName, presetCredits, presetHref } from '../_lib/tokens';

// The aspect the studio will actually use: the template's, when its model
// takes it (same rule as app/create), otherwise none is shown or sent.
function usableAspect(preset, model) {
  if (!preset.aspect || !model) return null;
  const options = model.aspects ? ASPECT_RATIOS.filter((a) => model.aspects.includes(a)) : [];
  return options.includes(preset.aspect) ? preset.aspect : null;
}

export function UseTemplate({ preset, prompt = preset.prompt }) {
  const router = useRouter();
  const { models } = useCatalog();
  const modelId = modelIdForName(preset.model);
  const model = models.find((m) => m.id === modelId) || null;
  const aspect = usableAspect(preset, model);
  const credits = presetCredits(preset, models);
  const [handoffError, setHandoffError] = useState(false);

  function use() {
    // The URL restores the recipe if storage is blocked; preserve edited text.
    if (modelId) {
      let saved = false;
      try { saved = writeStudioDraft(window.sessionStorage, { prompt, model: modelId, aspect, durationSeconds: preset.durationSeconds, negativePrompt: preset.negativePrompt, templateId: preset.id }); } catch { /* The unedited URL recipe still works. */ }
      if (!saved && prompt !== preset.prompt) { setHandoffError(true); return; }
    }
    router.push(presetHref(preset));
  }

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 gap-3 text-[14px]">
        <div><dt className="text-vx-fg-muted">Cost</dt><dd className="font-vx-mono vx-num text-[22px] font-bold text-vx-money">{credits} cr</dd></div>
        {aspect && <div><dt className="text-vx-fg-muted">Aspect ratio</dt><dd className="font-vx-mono text-[22px] font-bold">{aspect}</dd></div>}
        {preset.durationSeconds && <div><dt className="text-vx-fg-muted">Duration</dt><dd className="font-vx-mono text-[22px] font-bold">{preset.durationSeconds}s</dd></div>}
      </dl>
      <button
        type="button"
        onClick={use}
        disabled={!prompt.trim()}
        className="vx-press mt-6 inline-flex items-center rounded-full bg-vx-accent px-6 py-3 font-bold text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-50"
      >
        {preset.sourceRecipe ? 'Create a similar video' : 'Use this template'}
      </button>
      <p className="mt-3 text-[13px] text-vx-fg-muted">Nothing is charged until you press Generate. Failed generations refund in full.</p>
      {handoffError && <p role="alert" className="mt-3 text-[13px] text-vx-danger">Your browser blocked saving this edit. Copy the prompt, then <a href={presetHref(preset)} className="underline">open the studio</a> and paste it there.</p>}
    </div>
  );
}
