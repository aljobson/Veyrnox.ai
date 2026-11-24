import Link from 'next/link';
import { getT } from '../../../lib/i18n/server';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { FooterForest } from '../_sections/footer';

export async function generateMetadata() {
  const { t } = await getT();
  const description = t('editors.meta.description');
  return {
    title: t('editors.meta.title'),
    description,
    alternates: { canonical: '/editors' },
    openGraph: {
      title: t('editors.meta.ogTitle'),
      description,
      url: '/editors',
    },
  };
}

const editorCards = [
  { id: 'video', number: '01', href: '/app/library' },
  { id: 'audio', number: '02', href: '/app/music' },
  { id: 'smart', number: '03', href: '/app/library#smart-cut' },
];

const workflow = [1, 2, 3, 4];
const principles = ['source', 'preview', 'inspect', 'spend'];

function TimelinePreview({ t }) {
  return (
    <div className="rounded-[1.75rem] border border-vx-border bg-vx-panel p-4 shadow-2xl sm:p-6" aria-label={t('editors.preview.aria')}>
      <div className="flex items-center justify-between gap-3 border-b border-vx-border pb-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('editors.preview.kicker')}</p>
          <p className="mt-1 text-sm font-extrabold text-vx-fg">{t('editors.preview.title')}</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1.5 font-vx-mono text-[10px] font-bold text-vx-fg-muted">00:38</span>
      </div>

      <div className="mt-5 rounded-2xl border border-vx-border bg-vx-base p-3">
        <div className="flex items-center justify-between text-[10px] font-bold text-vx-fg-muted">
          <span>{t('editors.preview.source')}</span><span className="font-vx-mono">01:12</span>
        </div>
        <div className="mt-3 grid grid-cols-[1.2fr_.5fr_1fr_.35fr_.8fr] gap-1" aria-hidden="true">
          <span className="h-12 rounded-lg bg-vx-panel-raised" />
          <span className="h-12 rounded-lg border border-vx-danger/50 bg-vx-danger/10" />
          <span className="h-12 rounded-lg bg-vx-panel-raised" />
          <span className="h-12 rounded-lg border border-vx-danger/50 bg-vx-danger/10" />
          <span className="h-12 rounded-lg bg-vx-panel-raised" />
        </div>
        <div className="mt-2 flex gap-3 font-vx-mono text-[9px] font-bold tracking-wide text-vx-fg-faint">
          <span>{t('editors.preview.take')}</span><span className="text-vx-danger">{t('editors.preview.pause')}</span><span>{t('editors.preview.take')}</span><span className="text-vx-danger">{t('editors.preview.review')}</span>
        </div>
      </div>

      <div className="my-3 flex items-center justify-center gap-2 font-vx-mono text-[10px] font-bold text-vx-accent">
        <span aria-hidden="true">↓</span> {t('editors.preview.plan')} <span aria-hidden="true">↓</span>
      </div>

      <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-3">
        <div className="flex items-center justify-between text-[10px] font-bold text-vx-fg-muted">
          <span>{t('editors.preview.proposed')}</span><span className="font-vx-mono text-vx-accent">{t('editors.preview.sections')}</span>
        </div>
        <div className="mt-3 grid grid-cols-[1.2fr_1fr_.8fr] gap-1" aria-hidden="true">
          <span className="h-12 rounded-lg bg-vx-accent/30" />
          <span className="h-12 rounded-lg bg-vx-accent/20" />
          <span className="h-12 rounded-lg bg-vx-accent/35" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-vx-fg">{t('editors.preview.approval')}</span>
          <span className="rounded-full bg-vx-accent px-3 py-1.5 text-[10px] font-extrabold text-vx-accent-ink">{t('editors.preview.apply')}</span>
        </div>
      </div>
    </div>
  );
}

export default async function EditorsPage() {
  const { locale, t } = await getT();
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main>
        <section className="mx-auto grid max-w-[1300px] gap-10 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)] lg:items-center lg:gap-16">
          <div>
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">{t('editors.hero.kicker')}</p>
            <h1 className="vx-display vx-title-index mt-4 max-w-[11ch]">{t('editors.hero.title')}</h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-8 text-vx-fg-body sm:text-xl">{t('editors.hero.lead')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/app/library#smart-cut" className="vx-press inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                {t('editors.hero.start')} <span aria-hidden="true" className="ml-2">→</span>
              </Link>
              <a href="#editor-suite" className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                {t('editors.hero.compare')}
              </a>
            </div>
            <dl className="mt-9 grid max-w-[42rem] grid-cols-3 gap-px overflow-hidden rounded-2xl border border-vx-border bg-vx-border">
              {['video', 'audio', 'spend'].map((stat) => <div key={stat} className="bg-vx-panel p-4"><dt className="font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">{t(`editors.stat.${stat}.label`)}</dt><dd className="mt-1 text-sm font-black">{t(`editors.stat.${stat}.value`)}</dd></div>)}
            </dl>
          </div>
          <TimelinePreview t={t} />
        </section>

        <section id="editor-suite" aria-labelledby="editor-suite-heading" className="scroll-mt-24 border-y border-vx-border bg-vx-panel/45">
          <div className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6 sm:py-20">
            <div className="max-w-3xl">
              <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">{t('editors.suite.kicker')}</p>
              <h2 id="editor-suite-heading" className="vx-display mt-3 text-[42px] leading-none sm:text-[60px]">{t('editors.suite.title')}</h2>
              <p className="mt-5 max-w-[60ch] text-base leading-7 text-vx-fg-body">{t('editors.suite.lead')}</p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {editorCards.map((editor) => (
                <article key={editor.id} className="flex min-h-full flex-col rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <p className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-accent">{t(`editors.card.${editor.id}.eyebrow`)}</p>
                    <span className="font-vx-mono text-xl font-black text-vx-border-boost">{editor.number}</span>
                  </div>
                  <h3 className="mt-5 text-3xl font-black tracking-[-0.03em]">{t(`editors.card.${editor.id}.title`)}</h3>
                  <p className="mt-3 text-sm leading-6 text-vx-fg-body">{t(`editors.card.${editor.id}.intro`)}</p>
                  <ul className="mt-6 grid gap-3 border-t border-vx-border pt-5 text-sm leading-6 text-vx-fg-muted">
                    {[1, 2, 3, 4].map((feature) => <li key={feature} className="flex gap-3"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vx-accent" /><span>{t(`editors.card.${editor.id}.feature.${feature}`)}</span></li>)}
                  </ul>
                  <p className="mt-6 rounded-2xl bg-vx-base p-4 text-xs leading-5 text-vx-fg-muted"><strong className="text-vx-fg-body">{t('editors.boundary')} </strong>{t(`editors.card.${editor.id}.note`)}</p>
                  <Link href={editor.href} className="vx-press mt-6 inline-flex min-h-11 items-center justify-between rounded-full border border-vx-border px-4 text-sm font-extrabold text-vx-fg hover:border-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                    {t(`editors.card.${editor.id}.action`)} <span aria-hidden="true">→</span>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="workflow-heading" className="mx-auto grid max-w-[1300px] gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[.75fr_1.25fr] lg:gap-16">
          <div>
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">{t('editors.workflow.kicker')}</p>
            <h2 id="workflow-heading" className="vx-display mt-3 text-[42px] leading-none sm:text-[56px]">{t('editors.workflow.title')}</h2>
            <p className="mt-5 text-base leading-7 text-vx-fg-body">{t('editors.workflow.lead')}</p>
          </div>
          <ol className="divide-y divide-vx-border border-y border-vx-border">
            {workflow.map((step) => (
              <li key={step} className="grid gap-2 py-5 sm:grid-cols-[3rem_12rem_1fr] sm:items-start sm:gap-4">
                <span className="font-vx-mono text-sm font-black text-vx-accent">{String(step).padStart(2, '0')}</span>
                <strong className="text-base text-vx-fg">{t(`editors.workflow.${step}.title`)}</strong>
                <span className="text-sm leading-6 text-vx-fg-muted">{t(`editors.workflow.${step}.body`)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="editor-principles-heading" className="border-t border-vx-border bg-vx-panel">
          <div className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
              <div>
                <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">{t('editors.principles.kicker')}</p>
                <h2 id="editor-principles-heading" className="mt-3 text-3xl font-black tracking-[-0.03em]">{t('editors.principles.title')}</h2>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                {principles.map((principle) => <div key={principle} className="rounded-2xl border border-vx-border bg-vx-base p-5"><dt className="font-bold text-vx-fg">{t(`editors.principles.${principle}.title`)}</dt><dd className="mt-2 text-sm leading-6 text-vx-fg-muted">{t(`editors.principles.${principle}.body`)}</dd></div>)}
              </dl>
            </div>

            <div className="mt-12 flex flex-col items-start justify-between gap-5 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6 sm:flex-row sm:items-center sm:p-8">
              <div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('editors.final.kicker')}</p><p className="mt-2 text-xl font-black">{t('editors.final.text')}</p></div>
              <Link href="/app/library#smart-cut" className="vx-press inline-flex min-h-11 shrink-0 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">{t('editors.final.action')} <span aria-hidden="true" className="ml-2">→</span></Link>
            </div>
          </div>
        </section>
      </Main>
      <FooterForest locale={locale} t={t} flush />
    </div>
  );
}
