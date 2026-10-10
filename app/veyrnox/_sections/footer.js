import Link from 'next/link';
import { Logo } from '../_components/Logo';
import {
  FAQ,
  MORE_FEATURES,
  FOOTER_TAGLINE,
  footerStamp,
  SITE_UPDATED,
  SUPPORT_EMAIL,
  distinctShelfNames,
} from '../_lib/tokens';

/* ─── Every credit leaves a line: an example statement ─── */

// Built from live catalog rows, so the example never quotes a price the
// shelf above contradicts. Labelled as an example on the slip itself.
const SIGNUP_CREDITS = 10;

function exampleLines(catalog) {
  const images = catalog
    .filter((m) => m.kind === 'image' && !m.gated)
    .sort((a, b) => a.credits - b.credits);
  const audio = catalog.find((m) => m.kind === 'audio' && !m.gated);
  const nameOf = distinctShelfNames(catalog);
  const lines = [{ label: 'Sign-up credit', delta: SIGNUP_CREDITS }];
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
    charge(images[1], [{ label: `${nameOf(images[1])} failed, refund`, delta: images[1].credits, refund: true }]);
  }
  charge(audio);
  return lines;
}

const fmt = (n) => (n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`);

export function LedgerExample({ catalog }) {
  const lines = exampleLines(catalog);
  const balance = lines.reduce((n, l) => n + l.delta, 0);
  return (
    <section className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1fr] gap-12 lg:gap-20 items-center">
        <div className="order-2 lg:order-1 max-w-[460px] w-full mx-auto lg:mx-0">
          <div className="vx-paper-shadow">
            <div className="vx-paper px-6 sm:px-8 pt-9 pb-10">
              <div className="flex items-baseline justify-between text-[13px] font-bold">
                <span>Credit statement</span>
                <span className="font-normal text-vx-fg-muted">Example</span>
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
                <span>Balance</span>
                <span className="text-vx-money">{balance} cr</span>
              </div>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <h2 className="vx-display text-[40px] sm:text-[56px] max-w-[12ch]">Every credit leaves a line.</h2>
          <ul className="mt-10 space-y-7 max-w-[46ch]">
            <li>
              <p className="text-lg font-bold">Charged when you press Generate.</p>
              <p className="mt-1 text-vx-fg-body leading-[1.6]">At the price printed on the button, and never more after the fact.</p>
            </li>
            <li>
              <p className="text-lg font-bold">A failed job pays itself back.</p>
              <p className="mt-1 text-vx-fg-body leading-[1.6]">Safety rejects, timeouts and model errors each come back as their own line. You don&rsquo;t have to ask.</p>
            </li>
            <li>
              <p className="text-lg font-bold">Lines are never edited.</p>
              <p className="mt-1 text-vx-fg-body leading-[1.6]">Your balance is the sum of them, and the full history is in your account.</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ─── */

export function FAQBlock() {
  return (
    <section id="faq" className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1fr] gap-8 lg:gap-20">
        <h2 className="vx-display text-[40px] sm:text-[56px] lg:sticky lg:top-24 self-start">Questions.</h2>
        <div className="border-t-2 border-vx-fg">
          {FAQ.map((row) => (
            <details key={row.q} className="vx-details group border-b border-vx-border">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-6 py-5">
                <span className="text-[17px] font-bold">{row.q}</span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-2xl leading-none text-vx-fg-muted transition-transform duration-200 group-open:rotate-45 group-hover:text-vx-fg"
                >
                  +
                </span>
              </summary>
              <p className="pb-6 -mt-1 text-[15px] text-vx-fg-body leading-[1.65] max-w-[62ch]">
                {row.a}
                {row.link && (
                  <>
                    {' '}
                    <Link href={row.link.href} className="font-bold text-vx-fg underline underline-offset-4 hover:text-vx-accent">
                      {row.link.label}
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

export function ClosingCTA() {
  return (
    <section className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <h2 className="vx-display vx-title-index max-w-[11ch]">
        Your first 10 credits are on us.
      </h2>
      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link href="/app?auth=sign_up" className="vx-press rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover">
          Claim 10 credits
        </Link>
        <p className="text-vx-fg-muted text-[15px]">No card needed. Spend them on any open model.</p>
      </div>
    </section>
  );
}

/* ─── Footer forest ─── */

export function FooterForest({ catalog }) {
  // Every model is a real catalog id and opens the studio on that model.
  // They run as their own band under the short columns: as a fifth column
  // the list was four times the height of its neighbours, and on a phone it
  // left half the width empty for a thousand pixels.
  const nameOf = distinctShelfNames(catalog);
  const models = catalog.map((m) => ({
    label: nameOf(m) + (m.premium ? ' ◆' : ''),
    href: `/app/create?model=${encodeURIComponent(m.id)}`,
  }));
  return (
    <footer className="mt-28 sm:mt-36 border-t border-vx-border">
      <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(3,1fr)] gap-8 sm:gap-10">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            {/* The wordmark is the conventional way back to the top of a
                site; it used to be inert down here. */}
            <Link href="/" aria-label="Veyrnox.ai home" className="inline-flex">
              <Logo size={28} wordmark />
            </Link>
            <p className="mt-4 text-sm text-vx-fg-body max-w-[320px] leading-[1.6]">{FOOTER_TAGLINE}</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-4 inline-block text-[13px] text-vx-accent underline underline-offset-4 hover:text-vx-accent-hover"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
          {MORE_FEATURES.map((col) => (
            <div key={col.group}>
              <h3 className="text-[13px] font-bold text-vx-fg mb-1.5">{col.group}</h3>
              <ul>
                {col.items.map((it) => (
                  <li key={it.label}>
                    <FooterLink href={it.href}>{it.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {models.length > 0 && (
          <div className="mt-10 border-t border-vx-border pt-8">
            <h3 className="text-[13px] font-bold text-vx-fg mb-1.5">Models</h3>
            <ul className="columns-2 sm:columns-3 lg:columns-5 gap-x-8 sm:gap-x-10">
              {models.map((it) => (
                <li key={it.href} className="break-inside-avoid">
                  <FooterLink href={it.href}>{it.label}</FooterLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-vx-border">
        <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-4 text-xs text-vx-fg-muted flex flex-col md:flex-row items-start md:items-center justify-between gap-1 md:gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Called at render, not at module load: a constant froze the
                year to whenever the Worker bundle happened to boot. */}
            <span>{footerStamp()}</span>
            <span aria-hidden="true">·</span>
            <span>
              Last updated <time dateTime={SITE_UPDATED}>{formatUpdated(SITE_UPDATED)}</time>
            </span>
          </div>
          {/* py-2 on each link, taken back out of the bar's own padding: the
              row reads the same and a thumb gets 32px instead of 16. */}
          <div className="flex flex-wrap gap-x-4">
            <Link href="/legal/terms" className="py-2 transition-colors hover:text-vx-fg">Terms</Link>
            <Link href="/legal/privacy" className="py-2 transition-colors hover:text-vx-fg">Privacy</Link>
            <Link href="/legal/aup" className="py-2 transition-colors hover:text-vx-fg">Acceptable Use</Link>
            <Link href="/design-system" className="py-2 transition-colors hover:text-vx-fg">Design</Link>
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

export function formatUpdated(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
