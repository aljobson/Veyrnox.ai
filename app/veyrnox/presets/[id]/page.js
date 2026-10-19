import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { rich } from '../../../../lib/i18n/rich';
import { localizedHref } from '../../../../lib/i18n/locales.mjs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { TemplateRecipe } from '../../_components/TemplateRecipe';
import { FilmPlayer } from '../../_components/FilmPlayer';
import { ClipBadge } from '../../_components/ClipBadge';
import { SHOWCASE_CLIPS } from '../../_lib/showcase';
import { ALL_TEMPLATES, templateById, presetTitle, modelIdForName } from '../../_lib/tokens';
import { OPEN_GRAPH_BASE } from '../../../seo';

// Templates are static data, so each page is built once; the price is read
// from the live catalog in the browser (UseTemplate), never from here.
export function generateStaticParams() {
  return ALL_TEMPLATES.map((p) => ({ id: p.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { locale, t } = await getT();
  const { id } = await params;
  const template = templateById(id);
  if (!template) return { title: t("presets.detail.templateNotFound"), robots: { index: false } };
  const title = presetTitle(template.name);
  const description = t('presets.detail.metaDescription', { title, model: template.model });
  return {
    title: t('presets.detail.metaTitle', { title }),
    description,
    alternates: pageAlternates(locale, `/presets/${template.id}`),
    openGraph: { ...OPEN_GRAPH_BASE, title: t('meta.siteTitle', { title }), description, url: localizedHref(locale, `/presets/${template.id}`), ...openGraphLocale(locale) },
  };
}

export default async function TemplatePage({ params }) {
  const { locale, t } = await getT();
  const { id } = await params;
  const template = templateById(id);
  if (!template) notFound();
  const modelId = modelIdForName(template.model);
  const clip = SHOWCASE_CLIPS[template.clipKey];
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      {/* The shell every public page shares, so this page starts on the
          logo's edge. Its own width is the inner block. */}
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-28">
        <div className="max-w-[1052px]">
        <Link href={localizedHref(locale, '/presets')} className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">{t("home.templates.all")}</Link>
        {/* In one column the name, model and inputs come before the preview:
            a 9:16 clip fills a phone's first screen and used to push the
            title below it. From lg the preview is the left column again and
            spans both rows; the first row hugs the heading (auto) so a tall
            clip cannot open a gap above the recipe. */}
        <div className="mt-6 grid gap-x-10 gap-y-6 lg:grid-cols-[1fr_420px] lg:grid-rows-[auto_1fr] lg:gap-y-0">
          <div className="lg:col-start-2 lg:row-start-1">
            <p className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">
              {tOr(t, `presets.cat.${template.category}`, template.category)}{template.isNew ? t("presets.detail.new") : ''}
            </p>
            <h1 className="mt-2 vx-display vx-title-detail">{presetTitle(template.name)}</h1>
            <p className="mt-4 text-vx-fg-body">
              {rich(t('presets.detail.runsOn'), { model: modelId ? <Link href={localizedHref(locale, `/models/${encodeURIComponent(modelId)}`)} className="font-bold underline underline-offset-4">{template.model}</Link> : <span className="font-bold">{template.model}</span> })}
            </p>
            {template.needs && (
              <p className="mt-4 rounded-xl border border-vx-border px-4 py-3 text-[14px] text-vx-fg-body">
                {t('presets.detail.inputs', { inputs: template.needs })}
              </p>
            )}
          </div>
          <div className="lg:col-start-1 lg:row-start-1 lg:row-span-2">
            {clip ? (
              <div className="relative mx-auto max-w-[480px]">
                <FilmPlayer key={template.id} film={clip} label={t('presets.detail.preview', { title: presetTitle(template.name) })} aspectRatio={clip.aspectRatio || template.previewAspect || '9 / 16'} />
                <ClipBadge clip={clip} />
                <p className="mt-3 text-sm text-vx-fg-muted">{clip.generatedOnVeyrnox ? t("presets.detail.highQualityFiveSecondPreviewGenerated") : t("presets.detail.highQualityFiveSecondInspirationPreview")}</p>
              </div>
            ) : <div className="min-h-[280px] lg:min-h-[480px] rounded-2xl" style={{ background: template.bg }} aria-hidden />}
          </div>
          <div className="lg:col-start-2 lg:row-start-2">
            <TemplateRecipe key={template.id} preset={template} generatedPreview={clip?.generatedOnVeyrnox} />
          </div>
        </div>
        </div>
      </Main>
    </div>
  );
}
