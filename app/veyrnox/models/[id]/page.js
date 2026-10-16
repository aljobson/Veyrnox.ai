import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { PremiumTag } from '../../_components/PremiumTag';
import { findModel, modelFacts } from '../../_lib/modelPages';
import { creditLabel, modelPriceUnit } from '../../_lib/modelPricing';
import { OPEN_GRAPH_BASE } from '../../../seo';

// Per request, like /models: an inactive or delisted model 404s within the
// 5-minute catalog cache instead of living on in a prerendered page.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const model = await findModel(id);
  if (!model) return { title: 'Model not found', robots: { index: false } };
  const description = `${model.title} on Veyrnox: ${creditLabel(model.credits)} ${modelPriceUnit(model)} Failed generations refund in full.`;
  return {
    title: `${model.title} — ${creditLabel(model.credits)}`,
    description,
    alternates: { canonical: `/models/${model.id}` },
    openGraph: { ...OPEN_GRAPH_BASE, title: `${model.title} — Veyrnox.ai`, description, url: `/models/${model.id}` },
  };
}

export default async function ModelPage({ params }) {
  const { id } = await params;
  const model = await findModel(id);
  if (!model) notFound();
  const facts = modelFacts(model);

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      {/* The shell every public page shares, so this page starts on the
          logo's edge. The reading measure is the inner block. */}
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <div className="max-w-[852px]">
        <Link href="/models" className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">All models</Link>
        <h1 className="mt-4 vx-display vx-title-detail">{model.title}</h1>
        <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-vx-mono vx-num text-[40px] font-bold text-vx-money">{creditLabel(model.credits)}</span>
          <span className="text-lg text-vx-fg-muted">{modelPriceUnit(model)}</span>
          {model.gated && <PremiumTag />}
        </p>
        {/* The price rides the button, as it does everywhere else, and the
            button comes before the facts: on a phone it sat below the fold. */}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href={`/app/create?model=${encodeURIComponent(model.id)}`}
            className="vx-press inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover"
          >
            <span>Generate with {model.title}</span>
            <span className="font-vx-mono vx-num text-[15px] font-bold">{model.credits} cr</span>
          </Link>
          <Link href="/pricing" className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">Credit packs</Link>
        </div>
        <p className="mt-4 text-[14px] text-vx-fg-muted">Nothing is charged until you press Generate. Failed generations refund in full.</p>
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
