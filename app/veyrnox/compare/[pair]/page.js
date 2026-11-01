import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { findModel, modelFacts } from '../../_lib/modelPages';
import { modelPriceUnit } from '../../_lib/modelPricing';
import { creditValueRange, formatUsdRange } from '../../_lib/creditValue';
import { OPEN_GRAPH_BASE } from '../../../seo';
import { JsonLd } from '../../../seo';
import { breadcrumbLd } from '../../../../lib/jsonLd';
import { isPromptGenerator, parsePair, pairSlug } from '../../../../lib/comparePairs';
import { readPublicCreditPacks } from '../../../../lib/publicCreditPacks';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { localizedHref } from '../../../../lib/i18n/locales.mjs';

// Per request, like /models/<id>: the catalog decides which models exist.
export const dynamic = 'force-dynamic';

const creditsIn = (t, credits, locale) => t(pluralKey(t, locale, 'model.credits', credits), { n: credits });

// Two prompt-only generators of the same modality, in the one canonical order;
// anything else is not a comparison we publish.
async function load(slug) {
  const ids = parsePair(slug);
  if (!ids) return null;
  const [a, b] = await Promise.all(ids.map((id) => findModel(id)));
  if (!a || !b || a.modality !== b.modality || !isPromptGenerator(a) || !isPromptGenerator(b)) return null;
  return { a, b, canonical: pairSlug(a.id, b.id) };
}

export async function generateMetadata({ params }) {
  const { pair } = await params;
  const found = await load(pair);
  const { locale, t } = await getT();
  if (!found) return { title: t('model.notFound'), robots: { index: false } };
  const vars = { a: found.a.title, b: found.b.title };
  const description = t('compare.meta.desc', vars);
  const alternates = pageAlternates(locale, `/compare/${found.canonical}`);
  return {
    title: t('compare.meta.title', vars),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('meta.siteTitle', { title: t('compare.meta.title', vars) }), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default async function ComparePage({ params }) {
  const { pair } = await params;
  const found = await load(pair);
  if (!found) notFound();
  const { locale, t } = await getT();
  if (found.canonical !== pair) redirect(localizedHref(locale, `/compare/${found.canonical}`));
  const { a, b } = found;
  const packs = await readPublicCreditPacks();
  const models = [a, b];
  const price = (m) => `${creditsIn(t, m.credits, locale)} ${modelPriceUnit(m, t)}`;
  const usd = (m) => formatUsdRange(creditValueRange(m.credits, packs));
  const factsOf = models.map((m) => new Map(modelFacts(m, t).map((f) => [f.label, f.value])));
  const labels = [...new Set(factsOf.flatMap((facts) => [...facts.keys()]))];
  const rows = [
    { label: t('compare.row.price'), values: models.map(price) },
    ...(models.every(usd) ? [{ label: t('compare.row.usd'), values: models.map(usd) }] : []),
    ...labels.map((label) => ({ label, values: factsOf.map((facts) => facts.get(label) ?? '–') })),
  ];
  const title = t('compare.meta.title', { a: a.title, b: b.title });

  return (
    <div className="min-h-dvh">
      <JsonLd data={breadcrumbLd([
        { name: 'Veyrnox.ai', href: localizedHref(locale, '/') },
        { name: t('models.title'), href: localizedHref(locale, '/models') },
        { name: title, href: localizedHref(locale, `/compare/${found.canonical}`) },
      ])} />
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <div className="max-w-[852px]">
          <Link href={localizedHref(locale, '/models')} className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">{t('model.all')}</Link>
          <h1 className="mt-4 vx-display vx-title-detail">{title}</h1>
          <p className="mt-4 text-lg text-vx-fg-body">{t('compare.meta.desc', { a: a.title, b: b.title })}</p>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-vx-border">
                  <td className="py-3 pr-4" />
                  {models.map((m) => (
                    <th key={m.id} scope="col" className="py-3 pr-4 text-lg font-black">
                      <Link href={localizedHref(locale, `/models/${m.id}`)} className="underline-offset-4 hover:underline">{m.title}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-vx-border align-baseline">
                    <th scope="row" className="py-3 pr-4 text-[14px] font-normal text-vx-fg-muted">{row.label}</th>
                    {row.values.map((value, i) => <td key={models[i].id} className="py-3 pr-4 text-vx-fg-body">{value}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            {models.map((m) => (
              <Link
                key={m.id}
                href={`/app/create?model=${encodeURIComponent(m.id)}`}
                className="vx-press inline-flex items-center gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover"
              >
                <span>{t('model.generate', { title: m.title })}</span>
                <span className="font-vx-mono vx-num text-[15px] font-bold">{m.credits} cr</span>
              </Link>
            ))}
          </div>
        </div>
      </Main>
    </div>
  );
}
