import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { GUIDES, guideById } from '../../_lib/guides';
import { OPEN_GRAPH_BASE } from '../../../seo';
import { getT } from '../../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { localizedHref } from '../../../../lib/i18n/locales.mjs';

export function generateStaticParams() {
  return GUIDES.map((g) => ({ id: g.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const g = guideById(id);
  const { locale, t } = await getT();
  if (!g) return { title: t('guides.notFound'), robots: { index: false } };
  const title = t.messages[`guide.${g.id}.title`] ?? g.title;
  const summary = t.messages[`guide.${g.id}.summary`] ?? g.summary;
  const alternates = pageAlternates(locale, `/guides/${g.id}`);
  return {
    title,
    description: summary,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('meta.siteTitle', { title }), description: summary, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default async function GuidePage({ params }) {
  const { id } = await params;
  const g = guideById(id);
  if (!g) notFound();
  const { locale, t } = await getT();
  // A guide step added without a translation keeps its English words.
  const say = (key, fallback) => t.messages[key] ?? fallback;
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main>
      <article className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-28">
        <div className="max-w-[712px]">
        <Link href={localizedHref(locale, '/guides')} className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">{t('guides.all')}</Link>
        <h1 className="mt-4 vx-display vx-title-detail">{say(`guide.${g.id}.title`, g.title)}</h1>
        <p className="mt-4 text-lg text-vx-fg-body">{say(`guide.${g.id}.summary`, g.summary)}</p>
        <ol className="mt-10 space-y-6">
          {g.steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span aria-hidden className="shrink-0 font-vx-mono text-[14px] font-bold text-vx-accent pt-1 w-6">{i + 1}</span>
              <div>
                <h2 className="text-lg font-black">{say(`guide.${g.id}.s${i + 1}.title`, s.title)}</h2>
                <p className="mt-1 text-vx-fg-body leading-[1.55]">{say(`guide.${g.id}.s${i + 1}.body`, s.body)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
          {g.links.map((l, i) => (
            <Link key={l.href} href={localizedHref(locale, l.href)}
              className={i === 0 ? 'inline-flex items-center rounded-full bg-vx-accent px-6 py-3 font-bold text-vx-accent-ink hover:bg-vx-accent-hover' : 'self-center font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg'}>
              {say(`guide.${g.id}.l${i + 1}`, l.label)}
            </Link>
          ))}
        </div>
        </div>
      </article>
      </Main>
    </div>
  );
}
