import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { TemplateRecipe } from '../../_components/TemplateRecipe';
import { FilmPlayer } from '../../_components/FilmPlayer';
import { ClipBadge } from '../../_components/ClipBadge';
import { SHOWCASE_CLIPS } from '../../_lib/showcase';
import { ALL_TEMPLATES, templateById, presetTitle, modelIdForName } from '../../_lib/tokens';

// Templates are static data, so each page is built once; the price is read
// from the live catalog in the browser (UseTemplate), never from here.
export function generateStaticParams() {
  return ALL_TEMPLATES.map((p) => ({ id: p.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const t = templateById(id);
  if (!t) return { title: 'Template not found', robots: { index: false } };
  const title = presetTitle(t.name);
  const description = `${title}: a ${t.model} template. See the preview, prompt, inputs and credit cost before you generate.`;
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
  const clip = SHOWCASE_CLIPS[t.clipKey];
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      {/* The shell every public page shares, so this page starts on the
          logo's edge. Its own width is the inner block. */}
      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-28">
        <div className="max-w-[1052px]">
        <Link href="/presets" className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">All templates</Link>
        {/* In one column the name, model and inputs come before the preview:
            a 9:16 clip fills a phone's first screen and used to push the
            title below it. From lg the preview is the left column again and
            spans both rows; the first row hugs the heading (auto) so a tall
            clip cannot open a gap above the recipe. */}
        <div className="mt-6 grid gap-x-10 gap-y-6 lg:grid-cols-[1fr_420px] lg:grid-rows-[auto_1fr] lg:gap-y-0">
          <div className="lg:col-start-2 lg:row-start-1">
            <p className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">
              {t.category}{t.isNew ? ' · NEW' : ''}
            </p>
            <h1 className="mt-2 vx-display vx-title-detail">{presetTitle(t.name)}</h1>
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
          </div>
          <div className="lg:col-start-1 lg:row-start-1 lg:row-span-2">
            {clip ? (
              <div className="relative mx-auto max-w-[480px]">
                <FilmPlayer key={t.id} film={clip} label={`${presetTitle(t.name)} preview`} aspectRatio={clip.aspectRatio || t.previewAspect || '9 / 16'} />
                <ClipBadge clip={clip} />
                <p className="mt-3 text-sm text-vx-fg-muted">{clip.generatedOnVeyrnox ? 'Five-second example generated on Veyrnox with the prompt below.' : 'Five-second source preview. Use the recipe to create your own version.'}</p>
              </div>
            ) : <div className="min-h-[280px] lg:min-h-[480px] rounded-2xl" style={{ background: t.bg }} aria-hidden />}
          </div>
          <div className="lg:col-start-2 lg:row-start-2">
            <TemplateRecipe key={t.id} preset={t} generatedPreview={clip?.generatedOnVeyrnox} />
          </div>
        </div>
        </div>
      </section>
    </div>
  );
}
