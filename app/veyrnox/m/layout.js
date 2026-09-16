import Link from 'next/link';
import { IOSFrame } from '../_components/IOSFrame';
import { MobileJumps } from './_MobileNav';

// These screens are a design prototype with sample data (balance, jobs,
// ledger rows). Say so on every screen and keep them out of search until
// they read a real account.
export const metadata = {
  title: { default: 'Mobile prototype', template: '%s — Veyrnox.ai' },
  description: 'Design prototype of the Veyrnox mobile screens, rendered with sample data.',
  robots: { index: false, follow: false },
};

// Mobile-web wrapper: iPhone bezel for desktop viewing, jumps strip up top.
export default function MobileLayout({ children }) {
  return (
    <div className="min-h-dvh flex flex-col items-center py-6">
      <div role="note" className="mb-3 mx-4 max-w-[420px] rounded-full border border-vx-money/40 bg-vx-money/[0.08] px-4 py-2 text-center font-vx-mono text-[10px] tracking-[0.1em] text-vx-money">
        DESIGN PROTOTYPE · SAMPLE DATA, NOT YOUR ACCOUNT ·{' '}
        <Link href="/app" className="underline underline-offset-2 hover:text-vx-fg">OPEN THE APP</Link>
      </div>
      <MobileJumps />
      <IOSFrame>{children}</IOSFrame>
    </div>
  );
}
