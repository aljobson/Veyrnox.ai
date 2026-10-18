import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { PremiumTag } from '../../_components/PremiumTag';
import { findModel, modelFacts } from '../../_lib/modelPages';
import { modelPriceUnit } from '../../_lib/modelPricing';
import { OPEN_GRAPH_BASE } from '../../../seo';
import { getT } from '../../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { localizedHref } from '../../../../lib/i18n/locales.mjs';

// Per request, like /models: an inactive or delisted model 404s within the
// 5-minute catalog cache instead of living on in a prerendered page.
export const dynamic = 'force-dynamic';

// "19 credits" / "1 credit" in the page's language.
const creditsIn = (t, credits, locale) => t(pluralKey(t, locale, 'model.credits', credits), { n: credits });

export async function generateMetadata({ params }) {
  const { id } = await params;
  const model = await findModel(id);
  const { locale, t } = await getT();
  if (!model) return { title: t('model.notFound'), robots: { index: false } };
  const credits = creditsIn(t, model.credits, locale);
  const description = t('model.desc', { title: model.title, credits, unit: modelPriceUnit(model, t) });
  const alternates = pageAlternates(locale, `/models/${model.id}`);
  return {
    title: `${model.title} — ${credits}`,
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('meta.siteTitle', { title: model.title }), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default async function ModelPage({ params }) {
  const { id } = await params;
  const model = await findModel(id);
  if (!model) notFound();
  const { locale, t } = await getT();
  const facts = modelFacts(model, t);

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      {/* The shell every public page shares, so this page starts on the
          logo's edge. The reading measure is the inner block. */}
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <div className="max-w-[852px]">
        <Link href={localizedHref(locale, '/models')} className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">{t('model.all')}</Link>
        <h1 className="mt-4 vx-display vx-title-detail">{model.title}</h1>
        <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-vx-mono vx-num text-[40px] font-bold text-vx-money">{creditsIn(t, model.credits, locale)}</span>
          <span className="text-lg text-vx-fg-muted">{modelPriceUnit(model, t)}</span>
          {model.gated && <PremiumTag />}
        </p>
        {/* The price rides the button, as it does everywhere else, and the
            button comes before the facts: on a phone it sat below the fold. */}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href={`/app/create?model=${encodeURIComponent(model.id)}`}
            className="vx-press inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover"
          >
            <span>{t('model.generate', { title: model.title })}</span>
            <span className="font-vx-mono vx-num text-[15px] font-bold">{model.credits} cr</span>
          </Link>
          <Link href={localizedHref(locale, '/pricing')} className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">{t('model.packs')}</Link>
        </div>
        <p className="mt-4 text-[14px] text-vx-fg-muted">{t('model.note')}</p>
        <dl className="mt-10 border-t border-vx-border">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 py-3 border-b border-vx-border">
              <dt className="sm:w-48 shrink-0 text-[14px] text-vx-fg-muted">{f.label}</dt>
              <dd className="text-vx-fg-body">{f.value}</dd>
            </div>
          ))}
        </dl>
        </div>
      </Main>
    </div>
  );
}
