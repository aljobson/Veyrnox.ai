import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { UseTemplate } from '../../_components/UseTemplate';
import { PRESETS, templateById, presetTitle, modelIdForName } from '../../_lib/tokens';

// Templates are static data, so each page is built once; the price is read
// from the live catalog in the browser (UseTemplate), never from here.
export function generateStaticParams() {
  return PRESETS.map((p) => ({ id: p.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const t = templateById(id);
  if (!t) return { title: 'Template not found', robots: { index: false } };
  const title = presetTitle(t.name);
  const description = `${title}: a ready-made ${t.model} template. See the prompt and the credit cost before you generate.`;
  return {
    title: `${title} template`,
    description,
    alternates: { canonical: `/presets/${t.id}` },
    openGraph: { title: `${title} — Veyrnox.ai`, description, url: `/presets/${t.id}` },
  };
}

export default async function TemplatePage({ params }) {
  const { id } = await params;
  const t = templateById(id);
  if (!t) notFound();
  const modelId = modelIdForName(t.model);
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <section className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-28">
        <Link href="/presets" className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">All templates</Link>
        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_420px]">
          <div className="min-h-[280px] lg:min-h-[480px] rounded-3xl" style={{ background: t.bg }} aria-hidden />
          <div>
            <p className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">
              {t.category}{t.isNew ? ' · NEW' : ''}
            </p>
            <h1 className="mt-2 vx-display text-[40px] sm:text-[56px] leading-[0.95]">{presetTitle(t.name)}</h1>
            <p className="mt-4 text-vx-fg-body">
              Runs on{' '}
              {modelId
                ? <Link href={`/models/${encodeURIComponent(modelId)}`} className="font-bold underline underline-offset-4">{t.model}</Link>
                : <span className="font-bold">{t.model}</span>}
            </p>
            {t.needs && (
              <p className="mt-4 rounded-xl border border-vx-border px-4 py-3 text-[14px] text-vx-fg-body">
                <span className="font-bold">You add:</span> {t.needs}. You upload it in the studio.
              </p>
            )}
            <h2 className="mt-8 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">PROMPT</h2>
            <p className="mt-2 rounded-xl bg-vx-raised/60 px-4 py-3 text-[15px] leading-[1.55] text-vx-fg-body">{t.prompt}</p>
            <p className="mt-2 text-[13px] text-vx-fg-muted">You can edit it before you generate.</p>
            <UseTemplate preset={t} />
          </div>
        </div>
      </section>
    </div>
  );
}
