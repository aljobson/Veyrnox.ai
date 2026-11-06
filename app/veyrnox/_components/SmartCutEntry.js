'use client';

import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../lib/i18n/translate.mjs';

export function SmartCutEntry({ enabled, selectedCount, onEnable }) {
  const { t, locale } = useI18n();
  const number = selectedCount.toLocaleString(localeTag(locale));
  const steps = ['pick', 'review', 'create'];
  return (
    <section aria-labelledby="smart-cut-entry-title" className="mx-auto max-w-[1400px] px-4 pb-2 sm:px-8">
      <div className="overflow-hidden rounded-[1.75rem] border border-vx-accent/40 bg-vx-panel-raised shadow-[0_1px_0_rgb(var(--vx-border)),0_18px_48px_rgb(0_0_0/0.12)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-5 sm:p-7">
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.15em] text-vx-accent">{t('app.smartCut.entry.eyebrow')}</p>
            <h2 id="smart-cut-entry-title" className="vx-display mt-2 max-w-[13ch] text-[34px] sm:text-[44px]">{t('app.smartCut.entry.title')}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-vx-fg-body">
              {t('app.smartCut.entry.intro')}
            </p>
            <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-label={t('app.smartCut.entry.steps')}>
              {steps.map((step, index) => (
                <li key={step} className="rounded-2xl border border-vx-border bg-vx-base p-4">
                  <span className="font-vx-mono text-[10px] font-bold text-vx-accent">{String(index + 1).padStart(2, '0')}</span>
                  <strong className="mt-2 block text-sm text-vx-fg">{t(`app.smartCut.entry.step.${step}.title`)}</strong>
                  <span className="mt-1 block text-xs leading-5 text-vx-fg-muted">{t(`app.smartCut.entry.step.${step}.detail`)}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col justify-center border-t border-vx-border bg-vx-base/60 p-5 lg:border-l lg:border-t-0 sm:p-7">
            <span className="font-vx-mono text-[10px] font-bold tracking-[0.13em] text-vx-fg-muted">{t(enabled ? 'app.smartCut.entry.ready' : 'app.smartCut.entry.switch')}</span>
            <p className="mt-2 text-sm leading-6 text-vx-fg-body">
              {enabled
                ? selectedCount > 0
                  ? t(pluralKey(t, locale, 'app.smartCut.entry.selected', selectedCount), { count: number })
                  : t('app.smartCut.entry.select')
                : t('app.smartCut.entry.enableHelp')}
            </p>
            {enabled ? (
              <button type="button" onClick={() => document.getElementById('library-assets')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="vx-press mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                {t(selectedCount > 0 ? 'app.smartCut.entry.pickAnother' : 'app.smartCut.entry.pickBelow')}
              </button>
            ) : (
              <button type="button" onClick={onEnable} className="vx-press mt-5 min-h-11 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                {t('app.smartCut.entry.enable')}
              </button>
            )}
            <p className="mt-3 text-[11px] leading-5 text-vx-fg-muted">{t('app.smartCut.entry.privacy')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
