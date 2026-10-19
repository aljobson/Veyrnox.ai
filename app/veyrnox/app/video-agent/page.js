'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { gatewayFetch, notifyBalanceChanged, GatewayError } from '../../_lib/gateway';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { pushJobHistory, readJobHistory, jobsToWatch } from '../../_lib/jobHistory';
import { pickResumable } from '../../_lib/videoAgentResume';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { jobStateUi } from '../../_lib/studioStates';
import { videoAgentBalanceState } from '../../_lib/authenticatedMedia';
import { normaliseNarration, MAX_NARRATION_LENGTH } from '../../../../lib/montageNarration.js';

// Video agent (ADR-0074): brief -> plan and price -> Approve -> one priced job.
// Open to every signed-in user since rollout step 9; the server flag AGENT_VIDEO_ENABLED is the switch.
const MODEL_ID = 'video-agent';
const ASPECTS = ['9:16', '16:9', '1:1'];
const MIN_BRIEF = 3;
const MAX_BRIEF = 500;

const STEPS = ['1', '2', '3'];
const BRIEF_TIPS = ['app.videoAgent.tip1', 'app.videoAgent.tip2', 'app.videoAgent.tip3', 'app.videoAgent.tip4'];
const UNREACHABLE = { code: 'poll_unreachable' };
const errorFor = (e) => (e instanceof GatewayError ? { code: e.code, retryAfter: e.retryAfter } : { code: 'internal' });

export default function VideoAgent() {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : value.toLocaleString(localeTag(locale));
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [brief, setBrief] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [plan, setPlan] = useState(null); // { plan_id, idempotency_key, plan, credits, expires_at, brief, aspect }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [narrationText, setNarrationText] = useState('');
  const [approving, setApproving] = useState(false);
  const inFlight = useRef(false);
  const balanceRequest = useRef(0);
  const draftVersion = useRef(0);
  const mounted = useRef(true);
  const { jobs, startJobs, generating } = useStudioJobs({ onUnreachable: () => setError(UNREACHABLE) });
  const job = jobs[0];

  const refreshBalance = useCallback(async () => {
    const request = ++balanceRequest.current;
    setBalanceLoading(true);
    try {
      const next = await gatewayFetch('/balance', { signal: AbortSignal.timeout(15000) });
      if (request === balanceRequest.current) setBalance(next.balance);
    }
    catch { if (request === balanceRequest.current) setBalance(null); }
    finally { if (request === balanceRequest.current) setBalanceLoading(false); }
  }, []);
  useEffect(() => {
    refreshBalance();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshBalance(); };
    window.addEventListener('veyrnox:balance-changed', refreshBalance);
    window.addEventListener('focus', refreshBalance);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      balanceRequest.current += 1;
      window.removeEventListener('veyrnox:balance-changed', refreshBalance);
      window.removeEventListener('focus', refreshBalance);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshBalance]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; draftVersion.current += 1; };
  }, []);

  // After a reload, pick the run in flight back up: the job history in this browser knows it was started.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = pickResumable(jobsToWatch(readJobHistory()), MODEL_ID);
    if (pending) startJobs(pending);
  }, [startJobs]);

  const briefOk = brief.trim().length >= MIN_BRIEF && brief.trim().length <= MAX_BRIEF;
  const narration = normaliseNarration(narrationText);
  const expired = plan && Date.now() / 1000 > plan.expires_at;
  const balanceState = plan ? videoAgentBalanceState(balanceLoading ? null : balance, plan.credits) : 'unavailable';
  const cannotAfford = plan && balanceState !== 'ready';
  const stalePlan = plan && (plan.brief !== brief.trim() || plan.aspect !== aspect || (plan.narrationText || '') !== narration.text);

  function editDraft(setValue, value) {
    draftVersion.current += 1;
    setValue(value); setPlan(null); setError(null);
  }

  async function onPlan() {
    if (inFlight.current || !briefOk || !narration.ok) return;
    inFlight.current = true;
    const requestVersion = ++draftVersion.current;
    setBusy(true); setError(null); setPlan(null);
    try {
      const body = { brief: brief.trim(), aspect_ratio: aspect, ...(narration.text ? { narration_text: narration.text } : {}) };
      const p = await gatewayFetch('/montage/plan', { method: 'POST', body: JSON.stringify(body) });
      if (!mounted.current || requestVersion !== draftVersion.current) return;
      if (narration.text && (p.narration_text !== narration.text || p.plan?.narration_supported !== true)) throw new GatewayError(t('app.videoAgent.errorFallback'), { code: 'narration_unavailable' });
      setPlan({ ...p, brief: body.brief, aspect: body.aspect_ratio, narrationText: narration.text, draftVersion: requestVersion });
    } catch (e) {
      if (mounted.current && requestVersion === draftVersion.current) setError(errorFor(e));
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  // Approve sends exactly what was planned, under the key the plan names, so a
  // double click or a retry is a replay of one job, never a second run.
  async function onApprove() {
    if (inFlight.current || !plan || expired || cannotAfford || stalePlan || !narration.ok || plan.draftVersion !== draftVersion.current) return;
    inFlight.current = true;
    setBusy(true); setApproving(true); setError(null);
    try {
      const inputs = { brief: plan.brief, plan_id: plan.plan_id, aspect_ratio: plan.aspect, ...(plan.narrationText ? { narration_text: plan.narrationText } : {}) };
      const sent = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({ model_id: MODEL_ID, idempotency_key: plan.idempotency_key, inputs }),
      });
      startJobs({ job_id: sent.job_id, state: 'queued', credits: plan.credits, model_id: MODEL_ID });
      pushJobHistory({ job_id: sent.job_id, model_id: MODEL_ID, credits: plan.credits, prompt: plan.brief.slice(0, 60), name: plan.brief.slice(0, 40) });
      if (sent.balance_after != null) setBalance(sent.balance_after);
      notifyBalanceChanged();
      setPlan(null);
    } catch (e) {
      setError(errorFor(e));
    } finally { inFlight.current = false; setBusy(false); setApproving(false); }
  }

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="agent" />
      <Main className="max-w-3xl mx-auto px-4 sm:px-8 pt-6 pb-16">
        <div className="mb-3">
          <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.videoAgent.tag")}</div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] mt-1">{t("app.videoAgent.title")}</h1>
          <p className="mt-2 text-sm text-vx-fg-body">{t("app.videoAgent.intro")}</p>
        </div>

        <ol aria-label={t("app.videoAgent.how")} className="mb-4 grid gap-2 sm:grid-cols-3">
          {STEPS.map(n => (
            <li key={n} className="rounded-xl border border-vx-border bg-vx-panel p-3">
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">{t('app.videoAgent.step', { number: number(Number(n)) })}</div>
              <div className="mt-1 text-sm font-bold">{t(`app.videoAgent.step${n}Title`)}</div>
              <p className="mt-1 text-xs text-vx-fg-muted">{t(`app.videoAgent.step${n}Body`)}</p>
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
          <label htmlFor="brief" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.videoAgent.brief")}</label>
          <textarea
            id="brief" data-testid="agent-brief" rows={4} maxLength={MAX_BRIEF} value={brief} disabled={approving || generating}
            onChange={(e) => editDraft(setBrief, e.target.value)}
            placeholder={t("app.videoAgent.briefPlaceholder")}
            className="mt-2 w-full rounded-lg border border-vx-border bg-vx-bg p-3 text-sm"
          />
          <label htmlFor="narration-text" className="mt-4 block text-sm font-bold">{t("app.videoAgent.narration")}</label>
          <textarea id="narration-text" data-testid="agent-narration" rows={3} maxLength={MAX_NARRATION_LENGTH} value={narrationText}
            disabled={approving || generating} onChange={e => editDraft(setNarrationText, e.target.value)}
            aria-describedby="narration-help" className="mt-2 w-full rounded-lg border border-vx-border bg-vx-bg p-3 text-sm"
            placeholder={t("app.videoAgent.narrationPlaceholder")} />
          <p id="narration-help" data-testid="agent-narration-help" className="mt-2 text-xs text-vx-fg-muted">{t("app.videoAgent.narrationHelp")}</p>
          {!narration.ok && <p role="alert" className="mt-2 text-xs text-vx-danger">{t("app.videoAgent.narrationLimit")}</p>}
          <div className="mt-3 flex items-center gap-1.5" role="group" aria-label={t("label.Aspect ratio")}>
            {ASPECTS.map((a) => (
              <button
                key={a} type="button" aria-pressed={aspect === a} disabled={approving || generating}
                onClick={() => editDraft(setAspect, a)}
                className={`rounded-lg border px-3 py-1.5 font-vx-mono text-[11px] ${aspect === a ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}
              >{a}</button>
            ))}
            <button
              data-testid="agent-plan" type="button" onClick={onPlan} disabled={!briefOk || !narration.ok || busy || generating}
              className="ms-auto rounded-lg bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
            >{busy && !plan ? t("app.videoAgent.planning") : plan ? t("app.videoAgent.replan") : t("app.videoAgent.makePlan")}</button>
          </div>
          <p className="mt-2 text-xs text-vx-fg-muted">{t("app.videoAgent.freePlanning")}</p>
        </div>

        {error && (
          <div data-testid="agent-error" role="alert" className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger">
            {tOr(t, `app.create.error.${error.code}`, ERROR_COPY[error.code] || t('app.videoAgent.errorFallback'))}
            {error.retryAfter ? t('app.videoAgent.retry', { count: number(error.retryAfter) }) : ''}
          </div>
        )}

        {plan && (
          <div className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.videoAgent.plan")}</div>
            <p className="mt-2 text-sm text-vx-fg-body whitespace-pre-line">{plan.plan.summary || t("app.videoAgent.planFallback")}</p>
            {plan.plan.seconds && <p className="mt-1 text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'app.videoAgent.seconds', plan.plan.seconds), { count: number(plan.plan.seconds), aspect: plan.aspect })}</p>}
            {plan.narrationText && <section data-testid="agent-narration-preview" aria-label={t("app.videoAgent.approvedNarration")} className="mt-3 rounded-lg border border-vx-border p-3">
              <h2 className="text-sm font-bold">{t("app.videoAgent.narrationToSpeak")}</h2>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{plan.narrationText}</p>
              <p className="mt-2 text-xs text-vx-fg-muted">{t("app.videoAgent.reviewNarration")}</p>
            </section>}
            <div className="mt-4 flex items-center justify-between">
              <span data-testid="agent-balance" className="font-vx-mono text-[12px] text-vx-money vx-num">{t('app.videoAgent.balance', { credits: number(plan.credits), balance: balance == null ? '—' : number(balance) })}</span>
              <button
                data-testid="agent-approve" type="button" onClick={onApprove} disabled={busy || expired || cannotAfford || stalePlan || !narration.ok}
                className="rounded-lg bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
              >{t('app.videoAgent.approve', { credits: number(plan.credits) })}</button>
            </div>
            {expired && <p className="mt-2 text-xs text-vx-danger">{tOr(t, 'app.create.error.plan_expired', ERROR_COPY.plan_expired)}</p>}
            {balanceState === 'unavailable' && <div className="mt-3 text-sm text-vx-fg-muted">
              <p data-testid="agent-balance-status" role="status">{balanceLoading ? t("app.videoAgent.checkingBalance") : t("app.videoAgent.balanceUnavailable")}</p>
              <button type="button" disabled={balanceLoading || busy} data-testid="agent-retry-balance" onClick={refreshBalance} className="mt-2 text-vx-accent underline disabled:opacity-40">{t("app.videoAgent.retryBalance")}</button>
            </div>}
            {balanceState === 'insufficient' && <div className="mt-3 rounded-xl border border-vx-money/40 bg-vx-money/[0.06] p-3 text-sm">
              <p data-testid="agent-shortfall" className="text-vx-fg">{t(pluralKey(t, locale, 'app.videoAgent.moreCredits', plan.credits - balance), { count: number(plan.credits - balance) })}</p>
              <Link href="/app/credits" className="mt-2 inline-block font-bold text-vx-accent underline underline-offset-4">{t("app.videoAgent.compare")}</Link>
            </div>}
            <p className="mt-2 text-xs text-vx-fg-muted">{t("app.videoAgent.refund")}</p>
          </div>
        )}

        {job && (
          <div className={`mt-4 relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`} style={{ aspectRatio: aspect.replace(':', '/') }}>
            {job.asset_url ? <JobAssetPreview job={job} /> : (
              <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                <div>
                  <div className={`font-vx-mono text-[11px] tracking-[0.14em] ${job.state === 'failed' ? 'text-vx-danger' : 'text-vx-accent'}`}>
                    <span aria-hidden="true">{jobStateUi(job).glyph}</span> {tOr(t, `app.create.jobState.${job.state}`, jobStateUi(job).label)}
                  </div>
                  {job.state === 'failed'
                    ? <div className="mt-2 text-sm text-vx-fg-body">{failedJobCopy(job)}</div>
                    : <div className="mt-2 text-xs text-vx-fg-muted">{t("app.videoAgent.waiting")}</div>}
                </div>
              </div>
            )}
          </div>
        )}

        <section aria-labelledby="agent-help" className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-5">
          <h2 id="agent-help" className="text-lg font-black tracking-[-0.01em]">{t("app.videoAgent.before")}</h2>
          <h3 className="mt-3 text-sm font-bold">{t("app.videoAgent.writing")}</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-vx-fg-body">
            {BRIEF_TIPS.map(key => <li key={key}>{t(key)}</li>)}
          </ul>
          <h3 className="mt-4 text-sm font-bold">{t("app.videoAgent.after")}</h3>
          <p className="mt-1 text-sm text-vx-fg-body">{t("app.videoAgent.afterHelp")}</p>
          <h3 className="mt-4 text-sm font-bold">{t("app.videoAgent.money")}</h3>
          <p className="mt-1 text-sm text-vx-fg-body">{t("app.videoAgent.moneyHelp")}</p>
        </section>
      </Main>
    </div>
  );
}
