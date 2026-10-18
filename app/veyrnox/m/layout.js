import { pageAlternates } from '../../../lib/i18n/metadata.mjs';
import { getT, getSitePath } from '../../../lib/i18n/server';
import Link from 'next/link';
import { IOSFrame } from '../_components/IOSFrame';
import { MobileJumps } from './_MobileNav';
import { Main } from '../_components/Main';

// These screens are a design prototype with sample data (balance, jobs,
// ledger rows). Say so on every screen and keep them out of search until
// they read a real account.
export async function generateMetadata() {
  const { t, locale } = await getT();
  const path = await getSitePath();
  return {
    title: { default: t('mobile.meta.title'), template: t('meta.siteTemplate') },
    description: t('mobile.meta.description'),
    alternates: pageAlternates(locale, path || '/m'),
    robots: { index: false, follow: false },
  };
}

// Mobile-web wrapper: iPhone bezel for desktop viewing, jumps strip up top.
export default async function MobileLayout({ children }) {
  const { t } = await getT();
  return (
    <div className="min-h-dvh flex flex-col items-center py-6">
      <div role="note" className="mb-3 mx-4 max-w-[420px] rounded-full border border-vx-warn/40 bg-vx-warn/[0.08] px-4 py-2 text-center font-vx-mono text-[10px] tracking-[0.1em] text-vx-warn">
        {t('mobile.notice')}{' '}
        <Link href="/app" className="underline underline-offset-2 hover:text-vx-fg">{t('mobile.open')}</Link>
      </div>
      <MobileJumps />
      {/* Full width, so the frame centres and shrinks against the page as it did as a direct child. */}
      <Main className="w-full"><IOSFrame>{children}</IOSFrame></Main>
    </div>
  );
}
