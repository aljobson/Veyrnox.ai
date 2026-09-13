import Link from 'next/link';
import VeyrnoxLayout from './veyrnox/layout';
import { Logo } from './veyrnox/_components/Logo';

// Unmatched URLs render here instead of the unstyled Next.js default.
export default function NotFound() {
  return (
    <VeyrnoxLayout>
      <main className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center">
        <Link href="/" aria-label="Veyrnox.ai">
          <Logo size={36} wordmark />
        </Link>
        <div className="mt-4 font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">404 · PAGE NOT FOUND</div>
        <h1 className="text-4xl font-black tracking-[-0.02em] text-balance">This page isn&rsquo;t here.</h1>
        <p className="text-vx-fg-body max-w-[420px] leading-[1.6]">The link may be out of date, or the page has moved.</p>
        <Link
          href="/"
          className="mt-2 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
        >
          Back to Veyrnox.ai
        </Link>
      </main>
    </VeyrnoxLayout>
  );
}
