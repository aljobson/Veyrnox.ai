import Link from 'next/link';
import { OPEN_GRAPH_BASE } from '../../seo';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { getT } from '../../../lib/i18n/server';
import { appMessagesFor } from '../../../lib/i18n/appMessages.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { rich } from '../../../lib/i18n/rich';
import { translator } from '../../../lib/i18n/translate.mjs';

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
const PUBLISH_PLAN_FEATURES = ['accountsFeature', 'multiFeature', 'fairFeature', 'calendarFeature', 'historyFeature', 'csvFeature', 'recommendFeature', 'inboxFeature', 'commentsFeature'];
const PUBLISH_PLANS = [
  { id: 'publish-weekly', billingInterval: 'week', priceUsdCents: 499 },
  { id: 'publish', billingInterval: 'month', priceUsdCents: 1500 },
  { id: 'publish-annual', billingInterval: 'year', priceUsdCents: 12600, bestValue: true },
];
const link = 'font-bold underline underline-offset-4 hover:text-vx-accent';
const button = 'inline-block border-2 border-vx-fg px-6 py-3 font-black hover:text-vx-accent';
const planButton = 'mt-auto block w-full border-2 border-vx-fg px-4 py-3 text-center text-sm font-black hover:border-vx-accent hover:text-vx-accent';

export default async function PublishPage() {
  const { locale, t: publicT } = await getT();
  const t = translator(locale, { ...publicT.messages, ...await appMessagesFor(locale) });
  const money = new Intl.NumberFormat(localeTag(locale, 'en-US'), { style: 'currency', currency: 'USD' });
  const range = (count) => Array.from({ length: count }, (_, i) => i + 1);
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
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              <li className="flex flex-col border border-vx-border p-6">
                <p className="font-vx-mono text-[12px] font-bold uppercase tracking-[0.16em] text-vx-fg-muted">{t('publish.plan.colFree')}</p>
                <h3 className="mt-3 text-[44px] font-black leading-none">{money.format(0)}</h3>
                <p className="mt-3 text-sm text-vx-fg-muted">{t('app.publish.plan.freeIncluded')}</p>
                <ul className="my-6 space-y-3 border-t border-vx-border pt-5 text-sm text-vx-fg-body">
                  <li><strong className="text-vx-fg">{t('publish.plan.rowAccounts')}:</strong> 1</li>
                  <li><strong className="text-vx-fg">{t('publish.plan.rowPostNow')}:</strong> {t('publish.plan.yes')}</li>
                  <li><strong className="text-vx-fg">{t('publish.plan.rowScheduling')}:</strong> {t('publish.plan.no')}</li>
                  <li><strong className="text-vx-fg">{t('publish.plan.rowAnalytics')}:</strong> {t('publish.plan.basic')}</li>
                </ul>
                <Link href="/app/publish" className={planButton}>{t('publish.cta')}</Link>
              </li>
              {PUBLISH_PLANS.map((plan) => (
                <li key={plan.id} className={`flex flex-col border p-6 ${plan.bestValue ? 'border-vx-accent' : 'border-vx-border'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-vx-mono text-[12px] font-bold uppercase tracking-[0.16em] text-vx-accent">{t(`app.publish.plan.cadence.${plan.billingInterval}`)}</p>
                    {plan.bestValue && <span className="bg-vx-accent px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wide text-black">{t('app.publish.plan.save')}</span>}
                  </div>
                  <h3 className="mt-3 text-[44px] font-black leading-none">{money.format(plan.priceUsdCents / 100)}<span className="text-base font-normal text-vx-fg-muted"> / {t(`app.publish.plan.interval.${plan.billingInterval}`)}</span></h3>
                  {plan.bestValue
                    ? <p className="mt-3 text-xs text-vx-fg-muted">{t('app.publish.plan.equivalent', { price: money.format(plan.priceUsdCents / 1200) })}</p>
                    : <p className="mt-3 text-xs text-vx-fg-muted">{t('app.publish.plan.billing')}</p>}
                  <ul className="my-6 space-y-2.5 border-t border-vx-border pt-5 text-[13px] text-vx-fg-body">
                    {PUBLISH_PLAN_FEATURES.map((feature) => <li key={feature}>{t(`app.publish.plan.${feature}`)}</li>)}
                  </ul>
                  <Link href="/app/publish/plan" className={planButton}>{t('app.publish.plan.choose', { interval: t(`app.publish.plan.cadence.${plan.billingInterval}`) })}</Link>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-vx-fg-muted">{t('app.publish.plan.billing')}</p>
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
