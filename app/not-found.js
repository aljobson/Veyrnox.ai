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
      <div className="min-h-dvh flex flex-col items-center justify-center gap-5 px-4 sm:px-6 py-16 text-center">
        <Link href="/" aria-label="Veyrnox.ai — home">
          <Logo size={36} wordmark />
        </Link>
        <div className="mt-4 font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">404 · PAGE NOT FOUND</div>
        <h1 className="text-[32px] sm:text-4xl font-black tracking-[-0.02em] text-balance">This page isn&rsquo;t here.</h1>
        <p className="text-vx-fg-body max-w-[420px] leading-[1.6]">The link may be out of date, or the page has moved.</p>
        <Link
          href="/"
          className="mt-2 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
        >
          Back to Veyrnox.ai
        </Link>

        <div className="mt-8 w-full max-w-[560px] text-left">
          <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">TRY ONE OF THESE</div>
          <ul className="rounded-2xl border border-vx-border bg-vx-panel divide-y divide-vx-border/60">
            {suggestions.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="block px-5 py-3 transition-colors hover:bg-vx-accent/[0.06]"
                >
                  <span className="block text-[14px] font-bold text-vx-fg">{p.label}</span>
                  <span className="mt-0.5 block text-[12px] text-vx-fg-muted">{p.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </VeyrnoxLayout>
  );
}
