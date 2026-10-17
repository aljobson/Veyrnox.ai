import Link from 'next/link';
import VeyrnoxLayout from './veyrnox/layout';
import { Logo } from './veyrnox/_components/Logo';
import { Main } from './veyrnox/_components/Main';
import { SITE_PAGES } from './veyrnox/_lib/tokens';
import { getT } from '../lib/i18n/server';
import { localizedHref } from '../lib/i18n/locales.mjs';

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: t('notfound.meta.title'),
    description: t('notfound.meta.description'),
    robots: { index: false, follow: true },
  };
}

// Unmatched URLs render here instead of the unstyled Next.js default.
// A dead end is the wrong answer: offer the routes that do exist.
export default async function NotFound() {
  const { locale, t } = await getT();
  const suggestions = SITE_PAGES.filter((p) =>
    ['/', '/pricing', '/presets', '/app/create'].includes(p.href),
  );
  return (
    <VeyrnoxLayout>
      <div className="min-h-dvh max-w-[1300px] mx-auto px-4 sm:px-6 pt-8 pb-24">
        <header>
          <Link href={localizedHref(locale, '/')} aria-label={t('ui.home')} className="inline-flex">
            <Logo size={26} wordmark />
          </Link>
        </header>
        <Main className="mt-20 sm:mt-28 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-14 lg:gap-20 items-start">
          <div>
            <h1 className="vx-display vx-title-index max-w-[11ch]">{t('notfound.title')}</h1>
            <p className="mt-6 text-lg text-vx-fg-body max-w-[40ch] leading-[1.5]">{t('notfound.lead')}</p>
            <Link
              href={localizedHref(locale, '/')}
              className="vx-press inline-block mt-9 rounded-full bg-vx-fg text-vx-base px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-fg/85"
            >
              {t('notfound.back')}
            </Link>
          </div>
          {/* The 404 as a voided slip: the one printed object on the page. */}
          <div className="vx-paper-shadow max-w-[420px] w-full">
            <div className="vx-paper px-6 sm:px-8 pt-9 pb-10">
              <div className="flex items-baseline justify-between font-vx-mono text-[13.5px] font-bold vx-num">
                <span>{t('notfound.slip')}</span>
                <span>404</span>
              </div>
              <div className="vx-perf mt-4" aria-hidden />
              <h2 className="mt-5 text-[13px] font-bold">{t('notfound.try')}</h2>
              <ul className="mt-2">
                {suggestions.map((p) => (
                  <li key={p.href}>
                    <Link href={localizedHref(locale, p.href)} className="group flex items-baseline gap-2 py-2 font-vx-mono text-[13.5px]">
                      <span className="group-hover:underline underline-offset-4">{t.label(p.label)}</span>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="text-vx-fg-muted">{p.href}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Main>
      </div>
    </VeyrnoxLayout>
  );
}
