import LegalLink from '../../../components/LegalLink';
import Link from 'next/link';
import { ENTITY } from '../../legal/_lib/entity';
import { OPEN_GRAPH_BASE } from '../../seo';
import { Main } from '../_components/Main';
import { MarketingNav } from '../_components/NavBar';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { rich } from '../../../lib/i18n/rich';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/about');
  const description = t('about.meta.description');
  return {
    title: t('about.meta.title'),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('about.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default async function AboutPage() {
  const { t } = await getT();
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <article className="max-w-[760px]">
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('about.kicker')}</p>
          <h1 className="vx-display vx-title-index mt-5">{t('about.title')}</h1>
          <p className="mt-7 text-lg sm:text-xl text-vx-fg-body leading-[1.6]">
            {t('about.lead')}
          </p>

          <section className="mt-16 border-t-2 border-vx-fg pt-6" aria-labelledby="company-details">
            <h2 id="company-details" className="text-2xl font-black">{t('about.details')}</h2>
            <dl className="mt-6 border-t border-vx-border">
              <CompanyFact label={t('about.f.legal')} value={ENTITY.name} />
              <CompanyFact label={t('about.f.trading')} value={ENTITY.trading} />
              <CompanyFact label={t('about.f.number')} value={ENTITY.companyNo} />
              <CompanyFact label={t('about.f.registered')} value={ENTITY.jurisdiction} />
              <CompanyFact label={t('about.f.office')} value={ENTITY.office} />
            </dl>
          </section>

          <section className="mt-14" aria-labelledby="contact-details">
            <h2 id="contact-details" className="text-2xl font-black">{t('about.contact')}</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              {rich(t('about.contactP'), {
                email: <a className="font-bold underline underline-offset-4 hover:text-vx-accent" href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a>,
              })}
            </p>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              {rich(t('about.policiesP'), {
                terms: <LegalLink element="Link" className="font-bold underline underline-offset-4 hover:text-vx-accent" href="/legal/terms">{t('about.terms')}</LegalLink>,
                privacy: <LegalLink element="Link" className="font-bold underline underline-offset-4 hover:text-vx-accent" href="/legal/privacy">{t('about.privacy')}</LegalLink>,
                refund: <LegalLink element="Link" className="font-bold underline underline-offset-4 hover:text-vx-accent" href="/legal/refund">{t('about.refund')}</LegalLink>,
              })}
            </p>
          </section>
        </article>
      </Main>
    </div>
  );
}

function CompanyFact({ label, value }) {
  return (
    <div className="grid gap-1 border-b border-vx-border py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
      <dt className="text-[14px] text-vx-fg-muted">{label}</dt>
      <dd className="text-vx-fg-body">{value}</dd>
    </div>
  );
}
