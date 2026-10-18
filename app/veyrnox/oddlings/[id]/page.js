import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { OPEN_GRAPH_BASE } from '../../../seo';
import { getT } from '../../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { localizedHref } from '../../../../lib/i18n/locales.mjs';
import {
  ODDLINGS_PATH,
  localizeOddling,
  neighbouringOddlings,
  oddlingMetadata,
  oddlingsPublicEnabled,
  publicOddlingById,
} from '../../_lib/oddlingsPublic';
import { ShareLinkButton } from '../ShareLinkButton';

// The flag is a Worker var, so it is read on every request. Closed (the
// default in production) every character answers not-found. An id outside the
// cast does the same: notFound() below, a streamed not-found page marked noindex
// like /models/<id>. generateStaticParams and dynamicParams = false are not
// exported because force-dynamic makes them inert (tests/oddlingsPublicRender.test.mjs).
export const dynamic = 'force-dynamic';

const PRIMARY_BUTTON = 'vx-press inline-flex items-center rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover';
const QUIET_BUTTON = 'vx-press inline-flex items-center rounded-full border border-vx-border px-6 py-3.5 font-extrabold text-vx-fg-body hover:border-vx-fg/30 hover:text-vx-fg';

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { locale, t } = await getT();
  const oddling = oddlingsPublicEnabled() ? publicOddlingById(id) : null;
  if (!oddling) return { title: t('notfound.meta.title'), robots: { index: false } };
  const meta = oddlingMetadata(oddling, { t, alternates: pageAlternates(locale, oddling.path) });
  return { ...meta, openGraph: { ...OPEN_GRAPH_BASE, ...meta.openGraph, ...openGraphLocale(locale) } };
}

export default async function OddlingPage({ params }) {
  if (!oddlingsPublicEnabled()) notFound();
  const { id } = await params;
  const found = publicOddlingById(id);
  if (!found) notFound();
  const { locale, t } = await getT();
  const oddling = localizeOddling(found, t);
  const { premise, portrait } = oddling;
  const facts = [
    { label: t('oddlings.detail.obsession'), value: capitalise(premise.obsession) },
    { label: t('oddlings.detail.voice'), value: `${premise.voice}: ${premise.voiceNote}` },
    { label: t('oddlings.detail.show'), value: `${premise.show}: ${premise.showNote}` },
    { label: t('oddlings.detail.kind'), value: oddling.kindLabel },
  ];

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-28">
        <Link href={localizedHref(locale, ODDLINGS_PATH)} className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">{t('oddlings.detail.all')}</Link>
        <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:gap-16">
          <img
            src={portrait.src}
            alt={portrait.alt}
            width={portrait.width}
            height={portrait.height}
            decoding="async"
            className="aspect-[2/3] w-full rounded-2xl border border-vx-border bg-vx-panel object-contain"
          />
          <article>
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.14em] text-vx-accent">{oddling.accent}</p>
            <h1 className="mt-3 vx-display vx-title-detail">{oddling.name}</h1>
            <p className="mt-4 text-lg text-vx-fg-body max-w-[46ch] leading-[1.5]">{oddling.hook}</p>
            <p className="mt-4 text-[15px] text-vx-fg-muted max-w-[52ch] leading-[1.55]">
              {t('oddlings.detail.disclaimer', { name: oddling.name })}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {/* The heading names the character, so the visible text is the whole accessible name (WCAG 2.5.3). */}
              <Link href={oddling.studioHref} className={PRIMARY_BUTTON}>{t('oddlings.recreate')}</Link>
              <Link href={oddling.studioHref} className={QUIET_BUTTON}>{t('oddlings.detail.animateThis')}</Link>
              <ShareLinkButton
                path={localizedHref(locale, oddling.path)}
                title={t('oddlings.detail.title', { name: oddling.name })}
                label={t('oddlings.shareDefault')}
                messages={{ copied: t('oddlings.copied'), copyManual: t('oddlings.copyManual') }}
                className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg"
              />
            </div>
            <p className="mt-4 text-[14px] text-vx-fg-muted max-w-[52ch]">
              {t('oddlings.detail.studioNote')}
            </p>
            <dl className="mt-10 border-t border-vx-border">
              {facts.map((fact) => (
                <div key={fact.label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 py-3 border-b border-vx-border">
                  <dt className="sm:w-32 shrink-0 text-[14px] text-vx-fg-muted">{fact.label}</dt>
                  <dd className="text-vx-fg-body">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        </div>
        <section aria-labelledby="more-oddlings" className="mt-20">
          <h2 id="more-oddlings" className="border-b-2 border-vx-fg pb-2 text-xl font-black">{t('oddlings.detail.more')}</h2>
          <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {neighbouringOddlings(oddling.id).map((raw) => localizeOddling(raw, t)).map((other) => (
              <li key={other.id}>
                <Link href={localizedHref(locale, other.path)} className="group block">
                  <img
                    src={other.portrait.src}
                    alt=""
                    width={other.portrait.width}
                    height={other.portrait.height}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[2/3] w-full rounded-xl border border-vx-border bg-vx-panel object-contain transition-colors group-hover:border-vx-accent"
                  />
                  <span className="mt-2 block font-extrabold underline-offset-4 group-hover:underline">{other.name}</span>
                  <span className="block text-xs leading-relaxed text-vx-fg-muted">{other.hook}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </Main>
    </div>
  );
}
