import Link from 'next/link';
import VeyrnoxLayout from './veyrnox/layout';
import { Logo } from './veyrnox/_components/Logo';
import { SITE_PAGES } from './veyrnox/_lib/tokens';

export const metadata = {
  title: 'Page not found',
  description: 'That Veyrnox.ai page does not exist. Here is the way back.',
  robots: { index: false, follow: true },
};

// Unmatched URLs render here instead of the unstyled Next.js default.
// A dead end is the wrong answer: offer the routes that do exist.
export default function NotFound() {
  const suggestions = SITE_PAGES.filter((p) =>
    ['/', '/pricing', '/presets', '/app/create'].includes(p.href),
  );
  return (
    <VeyrnoxLayout>
      <div className="min-h-dvh max-w-[1300px] mx-auto px-4 sm:px-6 pt-8 pb-24">
        <Link href="/" aria-label="Veyrnox.ai home" className="inline-flex">
          <Logo size={26} wordmark />
        </Link>
        <div className="mt-20 sm:mt-28 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-14 lg:gap-20 items-start">
          <div>
            <h1 className="vx-display text-[52px] sm:text-[84px] max-w-[11ch]">This page isn&rsquo;t here.</h1>
            <p className="mt-6 text-lg text-vx-fg-body max-w-[40ch] leading-[1.5]">The link may be out of date, or the page has moved. Nothing was charged.</p>
            <Link
              href="/"
              className="vx-press inline-block mt-9 rounded-full bg-vx-fg text-vx-base px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-fg/85"
            >
              Back to Veyrnox.ai
            </Link>
          </div>
          {/* The 404 as a voided slip: the one printed object on the page. */}
          <div className="vx-paper-shadow max-w-[420px] w-full">
            <div className="vx-paper px-6 sm:px-8 pt-9 pb-10">
              <div className="flex items-baseline justify-between font-vx-mono text-[13.5px] font-bold vx-num">
                <span>Page not found</span>
                <span>404</span>
              </div>
              <div className="vx-perf mt-4" aria-hidden />
              <h2 className="mt-5 text-[13px] font-bold">Try one of these</h2>
              <ul className="mt-2">
                {suggestions.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="group flex items-baseline gap-2 py-2 font-vx-mono text-[13.5px]">
                      <span className="group-hover:underline underline-offset-4">{p.label}</span>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="text-vx-fg-muted">{p.href}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </VeyrnoxLayout>
  );
}
