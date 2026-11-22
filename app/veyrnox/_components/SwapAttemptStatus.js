'use client';
import { useEffect } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { useSwapDraft } from '../_lib/useSwapDraft.js';
import { swapActions } from '../_lib/templateSwapRuntime.js';
import { unsettled, swapErrorKey } from '../_lib/templateSwapClient.mjs';
import { GeneratingProgress } from '../app/create/GeneratingProgress.js';
export const swapControl = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-vx-border px-4 py-2 text-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-50';
function Attempt({ attempt: a }) {
  const { t } = useI18n();
  const poll = unsettled(a) && a.state !== 'submitting' && a.state !== 'unresolved';
  useEffect(() => {
    if (poll) void swapActions.reconcile(a.templateId, a.key).catch(() => {});
  }, [poll, a.accountId, a.templateId, a.key]);
  const success = ['queued', 'running', 'succeeded'].includes(a.state);
  return <div className="mt-4 space-y-4 rounded-2xl border border-vx-border p-4" data-swap-attempt={a.state}>
    <p role="status">{t(`presets.swap.${a.state}`, { credits: a.spent ?? a.body?.max_charge_credits })}</p>
    {/* Same reading as Create's canvas: the site-wide bar prints the percent, this prints its clock. */}
    {['queued', 'running'].includes(a.state) && a.job_id && <GeneratingProgress jobId={a.job_id} />}
    {a.state === 'refunded' && <p className="text-vx-danger">{t('presets.swap.refundedReason')}</p>}
    {a.state === 'not_charged' && <p className="text-vx-danger">{t(swapErrorKey(a.errorCode))}</p>}
    {Number.isFinite(a.balance) && <p className="text-vx-money">{t('presets.swap.balance', { credits: a.balance })}</p>}
    {a.state === 'unresolved' && <div className="flex flex-wrap gap-4">
      <button className={swapControl} onClick={() => void swapActions.reconcile(a.templateId, a.key).catch(() => {})}>{t('presets.swap.check')}</button>
      <a className={swapControl} href="mailto:support@veyrnox.com">{t('presets.swap.support')}</a>
    </div>}
    {success && <a href="/app/library" className={swapControl}>{t('presets.swap.library')}</a>}
    {!unsettled(a) && <button className={swapControl} onClick={() => swapActions.cancel(a.key)}>{t('presets.swap.dismiss')}</button>}
  </div>;
}
// Deliberately outside the availability branch: a gate refusal cannot hide money history.
export function SwapAttemptStatus({ templateId }) {
  const { attempts } = useSwapDraft(templateId);
  return <>{attempts.filter(a => a.body).map(a => <Attempt key={`${a.accountId}:${a.key}`} attempt={a} />)}</>;
}
