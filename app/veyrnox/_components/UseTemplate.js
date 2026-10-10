'use client';
import { useRouter } from 'next/navigation';
import { useCatalog } from '../_lib/useCatalog';
import { writeStudioDraft } from '../_lib/landingDraft';
import { ASPECT_RATIOS, modelIdForName, presetCredits, presetHref } from '../_lib/tokens';

// The aspect the studio will actually use: the template's, when its model
// takes it (same rule as app/create), otherwise none is shown or sent.
function usableAspect(preset, model) {
  if (!preset.aspect || !model) return null;
  const options = model.aspects ? ASPECT_RATIOS.filter((a) => model.aspects.includes(a))
    : model.kind === 'video' ? ASPECT_RATIOS : [];
  return options.includes(preset.aspect) ? preset.aspect : null;
}

export function UseTemplate({ preset }) {
  const router = useRouter();
  const { models } = useCatalog();
  const modelId = modelIdForName(preset.model);
  const model = models.find((m) => m.id === modelId) || null;
  const aspect = usableAspect(preset, model);
  const credits = presetCredits(preset, models);

  function use() {
    // Storage blocked: the studio still opens on the right model, without the prompt.
    if (modelId) writeStudioDraft(window.sessionStorage, { prompt: preset.prompt, model: modelId, aspect });
    router.push(presetHref(preset));
  }

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 gap-3 text-[14px]">
        <div><dt className="text-vx-fg-muted">Cost</dt><dd className="font-vx-mono vx-num text-[22px] font-bold text-vx-money">{credits} cr</dd></div>
        {aspect && <div><dt className="text-vx-fg-muted">Aspect ratio</dt><dd className="font-vx-mono text-[22px] font-bold">{aspect}</dd></div>}
      </dl>
      <button
        type="button"
        onClick={use}
        className="vx-press mt-6 inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover"
      >
        <span>Use this template</span>
        <span className="font-vx-mono vx-num text-[15px] font-bold">{credits} cr</span>
      </button>
      <p className="mt-3 text-[13px] text-vx-fg-muted">Nothing is charged until you press Generate. Failed generations refund in full.</p>
    </div>
  );
}
