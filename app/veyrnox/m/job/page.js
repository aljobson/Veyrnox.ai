import { localizedHref } from '../../../../lib/i18n/locales.mjs';

import { getT } from '../../../../lib/i18n/server';
import Link from 'next/link';
import { BalancePill } from '../../_components/BalancePill';
import { MobileTabs } from '../_MobileNav';

export default async function MobileJob() {
  const { t, locale } = await getT();
  const href = (path) => localizedHref(locale, path);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex flex-col p-[14px_18px_12px] overflow-y-auto">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{t('mobile.running')}</span>
          <BalancePill balance={807} tick="−16" tickTone="money" />
        </div>

        <div
          className="rounded-[14px] border border-vx-border overflow-hidden relative vx-shimmer"
          style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg,#0a1a2c,#144a7a,#3ec1e8)' }}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-white/80">{t('mobile.generating')}</div>
            <div className="font-vx-mono text-[42px] font-bold mt-1 vx-num">18s</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-4">
          <div className="flex justify-between items-baseline">
            <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t('mobile.state')}</span>
            <span className="font-vx-mono text-[11px] font-bold text-vx-accent">{t('mobile.rendering')}</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-vx-border overflow-hidden">
            <div className="h-full bg-vx-accent" style={{ width: '62%' }} />
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-vx-fg-muted">
            <span>{t('mobile.queued')}</span>
            <span>{t('mobile.renderTime')}</span>
            <span>{t('mobile.encode')}</span>
          </div>
          <div className="mt-4 text-[11.5px] text-vx-fg-body leading-[1.5]">
            {t('mobile.notify')}<b className="text-vx-accent">  {t('mobile.autoRefund')}</b>
          </div>
        </div>

        <div className="flex-1" />

        <Link
          href={href('/m/library')}
          className="mt-4 flex justify-center items-center bg-transparent border border-vx-border text-vx-fg rounded-full py-3.5 text-[14px] font-bold"
        >
          {t('mobile.goLibrary')}</Link>
      </div>
      <MobileTabs />
    </div>
  );
}
