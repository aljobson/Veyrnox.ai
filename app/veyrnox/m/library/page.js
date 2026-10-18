import { getT } from '../../../../lib/i18n/server';
import { MobileTabs } from '../_MobileNav';
import { Chip } from '../../_components/Chip';

const JOBS = [
  { name: 'Neon alley test',       model: 'Wan 2.5',           credits: -16, status: 'done',    when: ['mobile.minutesAgo', 2],  bg: 'linear-gradient(135deg,#1b0632,#5a0e6a,#e4318f)' },
  { name: 'Sunset drift v2',       model: 'MiniMax Hailuo 02', credits: -14, status: 'done',    when: ['mobile.minutesAgo', 14], bg: 'linear-gradient(135deg,#2b1a0a,#7a4a1e,#f0b060)' },
  { name: 'Product cut — coffee',  model: 'Seedream v4',       credits: -3,  status: 'running', when: ['mobile.now', 0],     bg: 'linear-gradient(135deg,#0a1a2c,#144a7a,#3ec1e8)' },
  { name: 'CCTV night hero',       model: 'Wan 2.5',           credits: +15, status: 'failed',  when: ['mobile.hoursAgo', 2],  bg: 'linear-gradient(180deg,#08120b,#0e3a1e,#2ea258)' },
];

export default async function MobileLibrary() {
  const { t } = await getT();
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-[14px_18px_16px]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{t('label.Library')}</span>
          <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">{t('mobile.failsRefund')}</span>
        </div>

        <div className="flex flex-col gap-2.5">
          {JOBS.map((j, i) => (
            <div key={i} className="flex gap-3 items-center bg-vx-panel border border-vx-border rounded-2xl p-2.5">
              <div
                className={`w-16 h-16 rounded-xl shrink-0 ${j.status === 'running' ? 'vx-shimmer' : ''}`}
                style={{ background: j.bg }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-[14px] font-bold truncate">{j.name}</div>
                </div>
                <div className="text-[11px] text-vx-fg-muted mt-0.5 truncate">{j.model} · {t(j.when[0], { n: j.when[1] })}</div>
                <div className="mt-1">
                  {j.status === 'done' && (
                    <Chip tone="accent" noGlyph>
                      <span aria-hidden="true" className="me-1">✓</span>{t('mobile.done')}</Chip>
                  )}
                  {j.status === 'running' && (
                    <Chip tone="accent" noGlyph>
                      <span aria-hidden="true" className="me-1">●</span>{t('mobile.inProgress')}</Chip>
                  )}
                  {j.status === 'failed' && (
                    <Chip tone="danger" noGlyph>
                      <span aria-hidden="true" className="me-1">✕</span>{t('mobile.failed')}</Chip>
                  )}
                </div>
              </div>
              <div className={`font-vx-mono text-[13px] font-bold pe-2 vx-num ${
                j.credits > 0 ? 'text-vx-accent' : 'text-vx-money'
              }`}>
                {j.credits > 0 ? '+' : ''}{j.credits} cr
              </div>
            </div>
          ))}
        </div>
      </div>
      <MobileTabs />
    </div>
  );
}
