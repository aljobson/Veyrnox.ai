import Link from 'next/link';
import { AUDIO_CATEGORIES, AUDIO_TEMPLATES, audioTemplatesIn } from '../_lib/audioTemplates';
import { MODELS } from '../_lib/tokens';
import { FreeAudioLibrary } from './FreeAudioLibrary';

// Audio templates, listed on /presets?kind=audio (the video gallery's own route, so no new
// page route, rewrite or telemetry pattern is needed). Filter key for "no category"; never shown.
const EVERY = '*';
const modelName = (id) => MODELS.find((m) => m.id === id)?.name || id;
const listHref = (c) => (c === EVERY ? '/presets?kind=audio' : `/presets?kind=audio&category=${encodeURIComponent(c)}`);

export function AudioTemplateGallery({ t, category }) {
  const active = AUDIO_CATEGORIES.includes(category) ? category : EVERY;
  const list = active === EVERY ? AUDIO_TEMPLATES : audioTemplatesIn(active);
  return (
    <>
      <h1 className="vx-display vx-title-index max-w-[14ch]">{t('audioTemplates.title')}</h1>
      <p className="mt-6 mb-8 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
        {t('audioTemplates.lead')}
      </p>
      <nav aria-label={t('audioTemplates.categories')} className="mb-8 flex flex-wrap gap-2">
        {[EVERY, ...AUDIO_CATEGORIES].map((c) => (
          <Link key={c} href={listHref(c)} aria-current={c === active ? 'page' : undefined}
            className="vx-press inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-vx-border px-4 text-[14px] font-semibold text-vx-fg-body hover:border-vx-fg-muted aria-[current=page]:border-vx-accent aria-[current=page]:bg-vx-accent aria-[current=page]:text-vx-accent-ink">
            {c === EVERY ? t('audioTemplates.all') : t(`audioTemplates.cat.${c}`)} ({c === EVERY ? AUDIO_TEMPLATES.length : audioTemplatesIn(c).length})
          </Link>
        ))}
        <a href="#free-audio" className="vx-press inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-vx-border px-4 text-[14px] font-semibold text-vx-fg-body hover:border-vx-fg-muted">{t('audioTemplates.free.title')}</a>
      </nav>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((tpl) => (
          <li key={tpl.id}>
            <Link href={`/presets/${encodeURIComponent(tpl.id)}`} className="block h-full rounded-2xl border border-vx-border p-5 hover:border-vx-fg">
              <p className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted"><span className="mr-2 rounded-full border border-vx-border px-2 py-0.5 font-bold">{t('templates.kind.audio')}</span>{t(`audioTemplates.cat.${tpl.category}`)}</p>
              <h2 className="mt-2 text-base font-extrabold tracking-tight">{tpl.name}</h2>
              <p className="mt-1 text-xs text-vx-fg-muted">{modelName(tpl.modelId)}</p>
              <p className="mt-3 line-clamp-3 text-[13px] text-vx-fg-body">{tpl.prompt}</p>
            </Link>
          </li>
        ))}
      </ul>
      <FreeAudioLibrary t={t} />
    </>
  );
}
