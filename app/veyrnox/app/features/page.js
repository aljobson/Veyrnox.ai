'use client';

import Link from 'next/link';
import { useI18n } from '../../../../components/I18nProvider';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { creativeFeatureGroups, translatedCreativeFeature } from '../../_lib/creativeFeatures';

export default function CreativeFeaturesPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="features" />
      <Main className="mx-auto max-w-[1320px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        <header className="max-w-4xl">
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.16em] text-vx-accent">{t('app.features.eyebrow')}</p>
          <h1 className="vx-display mt-4 text-[44px] leading-[0.94] sm:text-[68px]">{t('app.features.title')}</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-vx-fg-muted">{t('app.features.intro')}</p>
        </header>
        <div className="mt-12 space-y-12">
          {creativeFeatureGroups().map(({ group, features }) => <section key={group}>
            <div className="flex items-end justify-between border-b-2 border-vx-fg pb-3"><h2 className="text-2xl font-black">{translatedCreativeFeature(features[0], t).group}</h2><span className="font-vx-mono text-[10px] text-vx-fg-muted">{t('app.features.count', { count: features.length })}</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => { const copy = translatedCreativeFeature(feature, t); return <Link key={feature.slug} href={`/app/features/${feature.slug}`} className="group rounded-2xl border border-vx-border bg-vx-panel p-5 transition-colors hover:border-vx-accent">
                <div className="flex items-center justify-between gap-3"><span className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] text-vx-accent">{feature.kind}</span>{feature.blocked && <span className="rounded-full border border-vx-danger/35 px-2 py-1 text-[9px] font-bold text-vx-danger">{t('app.features.safeguarded')}</span>}</div>
                <h3 className="mt-4 text-lg font-black group-hover:text-vx-accent">{copy.title}</h3>
                <p className="mt-3 text-xs leading-5 text-vx-fg-muted">{copy.steps.join(' · ')}</p>
              </Link>; })}
            </div>
          </section>)}
        </div>
      </Main>
    </div>
  );
}
