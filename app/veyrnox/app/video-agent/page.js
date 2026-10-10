'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { gatewayFetch, notifyBalanceChanged, GatewayError } from '../../_lib/gateway';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { pushJobHistory, readJobHistory, jobsToWatch } from '../../_lib/jobHistory';
import { pickResumable } from '../../_lib/videoAgentResume';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { jobStateUi } from '../../_lib/studioStates';

// Video agent (ADR-0074): brief -> plan and price -> Approve -> one priced job.
// Open to every signed-in user since rollout step 9; the server flag AGENT_VIDEO_ENABLED is the switch.
const MODEL_ID = 'video-agent';
const ASPECTS = ['9:16', '16:9', '1:1'];
const MIN_BRIEF = 3;
const MAX_BRIEF = 500;

const errorFor = (e) => (e instanceof GatewayError ? { code: e.code, retryAfter: e.retryAfter } : { code: 'internal' });

export default function VideoAgent() {
  const [balance, setBalance] = useState(null);
  const [brief, setBrief] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [plan, setPlan] = useState(null); // { plan_id, idempotency_key, plan, credits, expires_at, brief, aspect }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const { jobs, startJobs, generating } = useStudioJobs({ onUnreachable: () => setError({ code: 'poll_unreachable' }) });
  const job = jobs[0];

  const refreshBalance = useCallback(async () => {
    try { setBalance((await gatewayFetch('/balance')).balance); } catch { /* the header shows a dash */ }
  }, []);
  useEffect(() => {
    refreshBalance();
    window.addEventListener('veyrnox:balance-changed', refreshBalance);
    return () => window.removeEventListener('veyrnox:balance-changed', refreshBalance);
  }, [refreshBalance]);

  // After a reload, pick the run in flight back up: the job history in this browser knows it was started.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = pickResumable(jobsToWatch(readJobHistory()), MODEL_ID);
    if (pending) startJobs(pending);
  }, [startJobs]);

  const briefOk = brief.trim().length >= MIN_BRIEF && brief.trim().length <= MAX_BRIEF;
  const expired = plan && Date.now() / 1000 > plan.expires_at;
  const cannotAfford = plan && balance != null && plan.credits > balance;

  async function onPlan() {
    if (inFlight.current || !briefOk) return;
    inFlight.current = true;
    setBusy(true); setError(null); setPlan(null);
    try {
      const body = { brief: brief.trim(), aspect_ratio: aspect };
      const p = await gatewayFetch('/montage/plan', { method: 'POST', body: JSON.stringify(body) });
      setPlan({ ...p, brief: body.brief, aspect: body.aspect_ratio });
    } catch (e) {
      setError(errorFor(e));
    } finally { inFlight.current = false; setBusy(false); }
  }

  // Approve sends exactly what was planned, under the key the plan names, so a
  // double click or a retry is a replay of one job, never a second run.
  async function onApprove() {
    if (inFlight.current || !plan || expired || cannotAfford) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const inputs = { brief: plan.brief, plan_id: plan.plan_id, aspect_ratio: plan.aspect };
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
    } finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="agent" />
      <Main className="max-w-3xl mx-auto px-4 sm:px-8 pt-6 pb-16">
        <div className="mb-3">
          <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">VIDEO AGENT</div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] mt-1">Make a video from a brief</h1>
        </div>

        <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
          <label htmlFor="brief" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">BRIEF</label>
          <textarea
            id="brief" rows={4} maxLength={MAX_BRIEF} value={brief} disabled={busy || generating}
            onChange={(e) => { setBrief(e.target.value); setPlan(null); }}
            placeholder="What should the video be about, and what should it feel like?"
            className="mt-2 w-full rounded-lg border border-vx-border bg-vx-bg p-3 text-sm"
          />
          <div className="mt-3 flex items-center gap-1.5" role="group" aria-label="Aspect ratio">
            {ASPECTS.map((a) => (
              <button
                key={a} type="button" aria-pressed={aspect === a} disabled={busy || generating}
                onClick={() => { setAspect(a); setPlan(null); }}
                className={`rounded-lg border px-3 py-1.5 font-vx-mono text-[11px] ${aspect === a ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}
              >{a}</button>
            ))}
            <button
              type="button" onClick={onPlan} disabled={!briefOk || busy || generating}
              className="ml-auto rounded-lg bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
            >{busy && !plan ? 'Planning…' : plan ? 'Re-plan' : 'Make a plan'}</button>
          </div>
          <p className="mt-2 text-xs text-vx-fg-muted">Planning is free. You are only charged when you approve the plan.</p>
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger">
            {ERROR_COPY[error.code] || 'Something went wrong. Nothing was charged.'}
            {error.retryAfter ? ` Try again in ${error.retryAfter}s.` : ''}
          </div>
        )}

        {plan && (
          <div className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">PLAN</div>
            <p className="mt-2 text-sm text-vx-fg-body whitespace-pre-line">{plan.plan.summary || 'The agent will plan, produce and edit your video.'}</p>
            {plan.plan.seconds && <p className="mt-1 text-xs text-vx-fg-muted">About {plan.plan.seconds} seconds · {plan.aspect}</p>}
            <div className="mt-4 flex items-center justify-between">
              <span className="font-vx-mono text-[12px] text-vx-money vx-num">{plan.credits} cr · balance {balance ?? '—'} cr</span>
              <button
                type="button" onClick={onApprove} disabled={busy || expired || cannotAfford}
                className="rounded-lg bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
              >Approve and make it · {plan.credits} cr</button>
            </div>
            {expired && <p className="mt-2 text-xs text-vx-danger">{ERROR_COPY.plan_expired}</p>}
            {cannotAfford && <p className="mt-2 text-xs text-vx-danger">{ERROR_COPY.insufficient_balance}</p>}
            <p className="mt-2 text-xs text-vx-fg-muted">If the video can&apos;t be made, the credits come back automatically.</p>
          </div>
        )}

        {job && (
          <div className={`mt-4 relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`} style={{ aspectRatio: aspect.replace(':', '/') }}>
            {job.asset_url ? <JobAssetPreview job={job} /> : (
              <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                <div>
                  <div className={`font-vx-mono text-[11px] tracking-[0.14em] ${job.state === 'failed' ? 'text-vx-danger' : 'text-vx-accent'}`}>
                    <span aria-hidden="true">{jobStateUi(job).glyph}</span> {jobStateUi(job).label}
                  </div>
                  {job.state === 'failed'
                    ? <div className="mt-2 text-sm text-vx-fg-body">{failedJobCopy(job)}</div>
                    : <div className="mt-2 text-xs text-vx-fg-muted">This can take several minutes. It keeps running if you leave, and we&apos;ll tell you when it&apos;s ready.</div>}
                </div>
              </div>
            )}
          </div>
        )}
      </Main>
    </div>
  );
}
