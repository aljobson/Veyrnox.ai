import LegalLink from '../../../components/LegalLink';
import Link from 'next/link';
import { Logo } from '../_components/Logo';
import { ENTITY } from '../../legal/_lib/entity';
import { translator } from '../../../lib/i18n/translate.mjs';
import { rich } from '../../../lib/i18n/rich';
import { localizedHref, localeInfo } from '../../../lib/i18n/locales.mjs';
import {
  FAQ,
  MORE_FEATURES,
  footerStamp,
  SITE_UPDATED,
  SUPPORT_EMAIL,
  distinctShelfNames,
} from '../_lib/tokens';

/* ─── Every credit leaves a line: an example statement ─── */

// Built from live catalog rows, so the example never quotes a price the
// shelf above contradicts. Labelled as an example on the slip itself.
const SIGNUP_CREDITS = 10;

function exampleLines(catalog, t) {
  const images = catalog
    .filter((m) => m.kind === 'image' && !m.gated)
    .sort((a, b) => a.credits - b.credits);
  const audio = catalog.find((m) => m.kind === 'audio' && !m.gated);
  const nameOf = distinctShelfNames(catalog);
  const lines = [{ label: t('home.ledger.signup'), delta: SIGNUP_CREDITS }];
  let balance = SIGNUP_CREDITS;
  // A line the running balance cannot cover is left out: the example never
  // prints a charge the account could not have paid.
  const charge = (row, extra = []) => {
    if (!row || row.credits > balance) return;
    lines.push({ label: nameOf(row), delta: -row.credits }, ...extra);
    balance += -row.credits + extra.reduce((n, l) => n + l.delta, 0);
  };
  charge(images[0]);
  if (images[1]) {
    charge(images[1], [{ label: t('home.ledger.failed', { name: nameOf(images[1]) }), delta: images[1].credits, refund: true }]);
  }
  charge(audio);
  return lines;
}

const fmt = (n) => (n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`);

export function LedgerExample({ catalog, locale = 'en' }) {
  const t = translator(locale);
  const lines = exampleLines(catalog, t);
  const balance = lines.reduce((n, l) => n + l.delta, 0);
  return (
    <section data-vey-perch className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1fr] gap-12 lg:gap-20 items-center">
        <div className="order-2 lg:order-1 max-w-[460px] w-full mx-auto lg:mx-0">
          <div className="vx-paper-shadow">
            <div className="vx-paper px-6 sm:px-8 pt-9 pb-10">
              <div className="flex items-baseline justify-between text-[13px] font-bold">
                <span>{t('home.ledger.statement')}</span>
                <span className="font-normal text-vx-fg-muted">{t('home.ledger.example')}</span>
              </div>
              <div className="vx-perf mt-4" aria-hidden />
              <dl className="mt-4 space-y-2 font-vx-mono text-[13.5px] vx-num">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <dt className={`min-w-0 ${l.refund ? 'text-vx-accent font-bold' : 'truncate'}`}>{l.label}</dt>
                    <span aria-hidden className="vx-leader flex-1" />
                    <dd className={`shrink-0 font-bold ${l.delta > 0 ? 'text-vx-accent' : 'text-vx-money'}`}>{fmt(l.delta)}</dd>
                  </div>
                ))}
              </dl>
              <div className="vx-perf mt-5" aria-hidden />
              <div className="mt-4 flex items-baseline justify-between font-vx-mono text-[15px] font-bold vx-num">
                <span>{t('home.ledger.balance')}</span>
                <span className="text-vx-money">{balance} cr</span>
              </div>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <h2 className="vx-display text-[40px] sm:text-[56px] max-w-[12ch]">{t('home.ledger.title')}</h2>
          <ul className="mt-10 space-y-7 max-w-[46ch]">
            <li>
              <p className="text-lg font-bold">{t('home.ledger.a.head')}</p>
              <p className="mt-1 text-vx-fg-body leading-[1.6]">{t('home.ledger.a.body')}</p>
            </li>
            <li>
              <p className="text-lg font-bold">{t('home.ledger.b.head')}</p>
              <p className="mt-1 text-vx-fg-body leading-[1.6]">{t('home.ledger.b.body')}</p>
            </li>
            <li>
              <p className="text-lg font-bold">{t('home.ledger.c.head')}</p>
              <p className="mt-1 text-vx-fg-body leading-[1.6]">{t('home.ledger.c.body')}</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ─── */

export function FAQBlock({ locale = 'en' }) {
  const t = translator(locale);
  return (
    <section data-vey-perch id="faq" className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1fr] gap-8 lg:gap-20">
        <h2 className="vx-display text-[40px] sm:text-[56px] lg:sticky lg:top-24 self-start">{t('home.faq.title')}</h2>
        <div className="border-t-2 border-vx-fg">
          {FAQ.map((row, i) => (
            <details key={row.q} className="vx-details group border-b border-vx-border">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-6 py-5">
                <span className="text-[17px] font-bold">{t(`home.faq.${i}.q`)}</span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-2xl leading-none text-vx-fg-muted transition-transform duration-200 group-open:rotate-45 group-hover:text-vx-fg"
                >
                  +
                </span>
              </summary>
              <p className="pb-6 -mt-1 text-[15px] text-vx-fg-body leading-[1.65] max-w-[62ch]">
                {t(`home.faq.${i}.a`)}
                {row.link && (
                  <>
                    {' '}
                    <Link href={localizedHref(locale, row.link.href)} className="font-bold text-vx-fg underline underline-offset-4 hover:text-vx-accent">
                      {t(`home.faq.${i}.link`)}
                    </Link>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Closing CTA ─── */

export function ClosingCTA({ locale = 'en' }) {
  const t = translator(locale);
  return (
    <section data-vey-perch className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      {/* A panel, not loose type: the last screen of the page reads as the
          place to act. The glow is one soft accent wash behind the headline. */}
      <div className="relative overflow-hidden rounded-2xl border border-vx-border bg-vx-panel px-6 py-14 sm:px-12 sm:py-20 lg:px-16 lg:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-vx-accent/20 blur-3xl"
        />
        <div className="relative">
          <h2 className="vx-display vx-title-index max-w-[11ch]">
            {t('home.cta.title')}
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href={localizedHref(locale, '/app/create?model=nano-banana-kie')} className="vx-press inline-flex min-h-11 items-center rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover">
              {t('home.cta.open')}
            </Link>
            <Link href={localizedHref(locale, '/pricing')} className="text-[15px] font-bold text-vx-fg-body underline decoration-vx-border decoration-2 underline-offset-[6px] hover:text-vx-fg hover:decoration-vx-accent">
              {t('home.hero.prices')}
            </Link>
          </div>
          <p className="mt-6 text-vx-fg-muted text-[15px]">{t('home.cta.note')}</p>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer forest ─── */

export function FooterForest({ locale = 'en' }) {
  const t = translator(locale);
  const info = localeInfo(locale);
  return (
    <footer className="mt-28 sm:mt-36 border-t border-vx-border">
      <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(4,1fr)] gap-8 sm:gap-10">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            {/* The wordmark is the conventional way back to the top of a
                site; it used to be inert down here. */}
            <Link href={localizedHref(locale, '/')} aria-label={t('ui.home')} className="inline-flex">
              <Logo size={28} wordmark />
            </Link>
            <p className="mt-4 text-sm text-vx-fg-body max-w-[320px] leading-[1.6]">{t('footer.tagline')}</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-4 inline-block text-[13px] text-vx-accent underline underline-offset-4 hover:text-vx-accent-hover"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
          {MORE_FEATURES.map((col) => (
            <div key={col.group}>
              <h3 className="text-[13px] font-bold text-vx-fg mb-1.5">{t.label(col.group)}</h3>
              <ul>
                {col.items.map((it) => (
                  <li key={it.label}>
                    <FooterLink href={localizedHref(locale, it.href)}>{t.label(it.label)}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-vx-border">
        <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-4 text-xs text-vx-fg-muted flex flex-col md:flex-row items-start md:items-center justify-between gap-1 md:gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Called at render, not at module load: a constant froze the
                year to whenever the Worker bundle happened to boot. */}
            <span>{footerStamp()}</span>
            <span aria-hidden="true">·</span>
            <span>{t('footer.company', { no: ENTITY.companyNo, jurisdiction: ENTITY.jurisdiction })}</span>
            <span aria-hidden="true">·</span>
            <span>
              {rich(t('footer.updated'), { date: <time dateTime={SITE_UPDATED}>{formatUpdated(SITE_UPDATED, info.hreflang)}</time> })}
            </span>
          </div>
          {/* py-2 on each link, taken back out of the bar's own padding: the
              row reads the same and a thumb gets 32px instead of 16. */}
          <div className="flex flex-wrap gap-x-4">
            <LegalLink element="Link" href="/legal/terms" className="py-2 transition-colors hover:text-vx-fg">{t.label('Terms')}</LegalLink>
            <LegalLink element="Link" href="/legal/privacy" className="py-2 transition-colors hover:text-vx-fg">{t.label('Privacy')}</LegalLink>
            <LegalLink element="Link" href="/legal/aup" className="py-2 transition-colors hover:text-vx-fg">{t.label('Acceptable Use')}</LegalLink>
            <LegalLink element="Link" href="/legal/cinema-content" className="py-2 transition-colors hover:text-vx-fg">{t.label('Cinema Content')}</LegalLink>
            <Link href="/design-system" className="py-2 transition-colors hover:text-vx-fg">{t.label('Design')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// mailto: and other external schemes go through a plain anchor — next/link
// is for routes it can prefetch.

// The row's height is the link's own padding, not a gap between rows, so the
// whole 32px pitch is tappable; as bare inline text each link was 14px tall.
export function FooterLink({ href, children }) {
  const cls = 'inline-block py-1.5 text-[13px] leading-5 text-vx-fg-body transition-colors hover:text-vx-fg underline-offset-4 hover:underline';
  if (!href) return <span className="inline-block py-1.5 text-[13px] leading-5 text-vx-fg-muted">{children}</span>;
  if (/^[a-z]+:/i.test(href)) {
    return <a href={href} className={cls}>{children}</a>;
  }
  return <Link href={href} className={cls}>{children}</Link>;
}

export function formatUpdated(iso, tag = 'en-GB') {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(tag === 'en' ? 'en-GB' : tag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
