import Link from 'next/link';
import { OPEN_GRAPH_BASE } from '../../seo';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { rich } from '../../../lib/i18n/rich';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/publish');
  const description = t('publish.meta.description');
  return {
    title: t('publish.meta.title'),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('publish.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

// Times are digits, so they read the same in every language.
const MONDAY_TIMES = ['09:00', '09:01', '09:02', '09:02'];
const FEATURE_COUNT = 10;
const FAQ_COUNT = 5;
const PLAN_ROWS = ['rowPrice', 'rowAccounts', 'rowPostNow', 'rowScheduling', 'rowAnalytics'];
const link = 'font-bold underline underline-offset-4 hover:text-vx-accent';
const button = 'inline-block border-2 border-vx-fg px-6 py-3 font-black hover:text-vx-accent';

export default async function PublishPage() {
  const { t } = await getT();
  const range = (count) => Array.from({ length: count }, (_, i) => i + 1);
  const planCells = {
    rowPrice: ['$0', `$15 ${t('publish.plan.perMonth')}`],
    rowAccounts: ['1', '5'],
    rowPostNow: [t('publish.plan.yes'), t('publish.plan.yes')],
    rowScheduling: [t('publish.plan.no'), t('publish.plan.yes')],
    rowAnalytics: [t('publish.plan.basic'), t('publish.plan.analyticsPaid')],
  };
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <article className="max-w-[860px]">
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">{t('publish.kicker')}</p>
          <h1 className="vx-display vx-title-index mt-5">{t('publish.title')}</h1>
          <p className="mt-7 text-lg sm:text-xl text-vx-fg-body leading-[1.6]">{t('publish.lead')}</p>
          <p className="mt-8">
            <Link href="/app/publish" className={button}>{t('publish.cta')}</Link>
            <span className="ms-4 text-[14px] text-vx-fg-muted">{t('publish.ctaNote')}</span>
          </p>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="load-once">
            <h2 id="load-once" className="text-2xl font-black">{t('publish.once.title')}</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">{t('publish.once.p1')}</p>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">{t('publish.once.p2')}</p>
          </section>

          <section className="mt-14" aria-labelledby="monday">
            <h2 id="monday" className="text-2xl font-black">{t('publish.monday.title')}</h2>
            <ul className="mt-6 border-t border-vx-border">
              {MONDAY_TIMES.map((time, i) => (
                <li key={i} className="grid gap-1 border-b border-vx-border py-4 sm:grid-cols-[120px_1fr] sm:gap-6">
                  <span className="font-vx-mono text-[14px] text-vx-fg-muted">{time}</span>
                  <span className="text-vx-fg-body">{t(`publish.monday.${i + 1}`)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="more">
            <h2 id="more" className="text-2xl font-black">{t('publish.more.title')}</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">{t('publish.more.lead')}</p>
            <dl className="mt-6 border-t border-vx-border">
              {range(FEATURE_COUNT).map((n) => (
                <div key={n} className="grid gap-1 border-b border-vx-border py-4 sm:grid-cols-[220px_1fr] sm:gap-6">
                  <dt className="font-bold">{t(`publish.f${n}.name`)}</dt>
                  <dd className="text-vx-fg-body leading-[1.6]">{t(`publish.f${n}.text`)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="plans">
            <h2 id="plans" className="text-2xl font-black">{t('publish.plan.title')}</h2>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] border-t border-vx-border text-start">
                <thead>
                  <tr className="border-b border-vx-border">
                    <th scope="col" className="py-3 pe-4"><span className="sr-only">{t('publish.plan.title')}</span></th>
                    <th scope="col" className="py-3 pe-4 text-start font-black">{t('publish.plan.colFree')}</th>
                    <th scope="col" className="py-3 text-start font-black">{t('publish.plan.colPlan')}</th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_ROWS.map((row) => (
                    <tr key={row} className="border-b border-vx-border">
                      <th scope="row" className="py-3 pe-4 text-start font-normal text-vx-fg-muted">{t(`publish.plan.${row}`)}</th>
                      <td className="py-3 pe-4 text-vx-fg-body">{planCells[row][0]}</td>
                      <td className="py-3 text-vx-fg-body">{planCells[row][1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              {rich(t('publish.plan.note'), { pricing: <Link className={link} href="/pricing">{t('publish.plan.noteLink')}</Link> })}
            </p>
          </section>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="faq">
            <h2 id="faq" className="text-2xl font-black">{t('publish.faq.title')}</h2>
            <dl className="mt-6 border-t border-vx-border">
              {range(FAQ_COUNT).map((n) => (
                <div key={n} className="border-b border-vx-border py-5">
                  <dt className="font-bold">{t(`publish.faq.q${n}`)}</dt>
                  <dd className="mt-2 text-vx-fg-body leading-[1.65]">{t(`publish.faq.a${n}`)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-10">
              <Link href="/app/publish" className={button}>{t('publish.cta')}</Link>
            </p>
          </section>
        </article>
      </Main>
    </div>
  );
}
