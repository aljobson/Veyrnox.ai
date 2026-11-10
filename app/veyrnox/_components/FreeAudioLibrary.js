import { FREE_AUDIO_KINDS, freeAudioIn, freeAudioUrl } from '../_lib/freeAudio';

// Free audio: public-domain recordings served from /free-audio. Plain <audio> and links,
// so it works without client JavaScript. Nothing here is priced or generated.
const minutes = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function FreeAudioLibrary({ t }) {
  return (
    <section id="free-audio" aria-labelledby="free-audio-title" className="mt-16 scroll-mt-24">
      <h2 id="free-audio-title" className="vx-display text-3xl sm:text-4xl">{t('audioTemplates.free.title')}</h2>
      <p className="mt-3 mb-8 max-w-[56ch] text-base text-vx-fg-body text-pretty">{t('audioTemplates.free.lead')}</p>
      {FREE_AUDIO_KINDS.map((kind) => (
        <div key={kind} className="mb-10">
          <h3 className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">{t(`audioTemplates.free.${kind}`)} ({freeAudioIn(kind).length})</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {freeAudioIn(kind).map((item) => (
              <li key={item.id} className="rounded-2xl border border-vx-border p-4">
                <p className="text-sm font-extrabold tracking-tight">{item.title}</p>
                <p className="mt-1 text-xs text-vx-fg-muted">{t('audioTemplates.free.by', { name: item.creator })} · {minutes(item.durationSec)} · {t('audioTemplates.free.pd')}</p>
                <audio controls preload="none" src={freeAudioUrl(item)} aria-label={item.title} className="mt-3 h-10 w-full" />
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                  <a href={freeAudioUrl(item)} download className="inline-flex min-h-11 items-center text-vx-accent underline underline-offset-2">{t('audioTemplates.free.download')}</a>
                  <a href={item.sourceUrl} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-11 items-center text-vx-fg-muted underline underline-offset-2">{t('audioTemplates.free.source')}</a>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
