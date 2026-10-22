import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { featuredModels, modelSummary, modelTag } from '../_lib/modelSummaries';

export function ModelsMenu({ active = false }) {
  const { t } = useI18n();
  const models = featuredModels();

  return (
    <details className="group relative">
      <summary
        aria-current={active ? 'page' : undefined}
        className={`flex cursor-pointer list-none items-center gap-1 rounded-full px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent [&::-webkit-details-marker]:hidden ${
          active ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'
        }`}
      >
        {t('label.Models')}
        <span aria-hidden="true" className="text-[10px] transition-transform group-open:rotate-180">▾</span>
      </summary>

      <div className="absolute left-0 top-[calc(100%+0.75rem)] z-50 w-[min(440px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-vx-border px-4 py-3">
          <div>
            <p className="text-sm font-black text-vx-fg">{t('models.title')}</p>
            <p className="mt-0.5 max-w-[28ch] text-[11px] font-medium text-vx-fg-muted">{t('models.meta.description')}</p>
          </div>
          <Link
            href="/models"
            className="rounded-full border border-vx-border px-3 py-1.5 text-[11px] font-bold text-vx-fg-body transition-colors hover:border-vx-fg-muted hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
          >
            {t('common.browseModels')}
          </Link>
        </div>

        <ul className="max-h-[min(70vh,520px)] overflow-y-auto p-2">
          {models.map((model) => {
            const tag = modelTag(model);
            return (
              <li key={model.id}>
                <Link
                  href={`/models/${encodeURIComponent(model.id)}`}
                  className="group/model grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-vx-base focus-visible:bg-vx-base focus-visible:outline-2 focus-visible:outline-vx-accent"
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-bold text-vx-fg">{model.name}</span>
                      {tag && (
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-vx-mono text-[9px] font-black ${
                          model.premium ? 'bg-vx-money/15 text-vx-money' : 'bg-vx-accent/12 text-vx-accent'
                        }`}>
                          {tag}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium text-vx-fg-muted">
                      {modelSummary(model)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end justify-center gap-0.5">
                    <span className="text-[10px] font-semibold text-vx-fg-muted">{t(`model.media.${model.kind}`)}</span>
                    <span className="font-vx-mono text-[11px] font-black text-vx-money">{model.credits} cr</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
