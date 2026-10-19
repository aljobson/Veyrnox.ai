'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import Link from 'next/link';
import { JobAssetPreview } from '../JobAssetPreview';
import { StudioJobGrid } from '../StudioJobGrid';
import { failedJobCopy } from '../../_lib/createErrors';
import { jobStateUi } from '../../_lib/studioStates';


export function MediaCanvas({ kind, media }) {
  const { t, locale } = useI18n();
  const { jobs, generating, model, aspect, clearJobs } = media;
  const job = jobs.length === 1 ? jobs[0] : null;
  const label = tOr(t,`app.editor.media.kind.${kind}`,t('app.publish.composer.mediaFallback'));

  if (!jobs.length) {
    return (
      <div className="mx-auto flex h-full max-w-[760px] flex-col items-center justify-center px-4 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-vx-border text-2xl text-vx-accent" aria-hidden="true">
          {kind === 'video' ? '▷' : kind === 'audio' ? '◖' : '▧'}
        </div>
        <h1 className="vx-display mt-5 text-[32px]">{t("app.chat.media.create",{kind:label})}</h1>
        <p className="mt-2 max-w-xl text-vx-fg-muted">{t("app.chat.media.help")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-3 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] uppercase tracking-[0.14em] text-vx-fg-muted">{model?.name || t("app.credits.statement.generation")}</p>
          <h1 className="mt-1 text-xl font-black">{generating ? t("app.chat.media.creating",{kind:label}) : job?.state === 'failed' ? t("public.vey.step.failed.title") : t("app.chat.media.ready",{kind:locale === 'en' ? label[0].toUpperCase()+label.slice(1) : label})}</h1>
        </div>
        {!generating && <button type="button" onClick={clearJobs} className="rounded-full border border-vx-border px-3 py-1.5 text-xs font-semibold text-vx-fg-muted hover:text-vx-fg">{t("app.chat.media.clear")}</button>}
      </div>

      {jobs.length > 1 ? <StudioJobGrid jobs={jobs} aspect={aspect || '1:1'} /> : (
        <div className={`relative overflow-hidden rounded-2xl border border-vx-border bg-vx-panel ${generating ? 'vx-shimmer' : ''}`}
          style={kind === 'audio' ? { minHeight: '12rem' } : { aspectRatio: (aspect || '1:1').replace(':', '/') }}>
          {job?.asset_url ? <JobAssetPreview job={job} /> : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <div>
                <p className={`font-vx-mono text-[11px] uppercase tracking-[0.14em] ${job?.state === 'failed' ? 'text-vx-danger' : 'text-vx-accent'}`}>
                  <span aria-hidden="true">{jobStateUi(job).glyph}</span> {tOr(t, `app.library.status.${job.state === 'failed' && job.refunded !== true ? 'failed_pending' : job.state}`, jobStateUi(job).label)}
                </p>
                {job?.state === 'failed'
                  ? <p className="mt-2 text-sm text-vx-fg-body">{failedJobCopy(job)}</p>
                  : <><p className="mt-3 text-4xl font-black">…</p><p className="mt-2 text-xs text-vx-fg-muted">{t("app.chat.media.switch")}</p></>}
              </div>
            </div>
          )}
        </div>
      )}
      {!generating && jobs.some((item) => item.state === 'succeeded') && (
        <p className="text-end text-xs text-vx-fg-muted">{t("app.chat.media.saved")}{' '}<Link href="/app/library" className="text-vx-accent hover:underline">{t("public.vey.action.open_library")}</Link></p>
      )}
    </div>
  );
}
