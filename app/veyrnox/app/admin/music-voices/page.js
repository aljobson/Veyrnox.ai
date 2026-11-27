'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { MfaPanel } from '../../../_components/MfaPanel';
import { gatewayFetch } from '../../../_lib/gateway';

const reasons = [
  ['evidence_consistent', 'Evidence is consistent'], ['phrase_mismatch', 'Phrase does not match'],
  ['reference_mismatch', 'Voices do not match'], ['synthetic_suspected', 'Possible synthetic or edited audio'],
  ['evidence_unreadable', 'Evidence cannot be reviewed'], ['policy_failed', 'Ownership policy not satisfied'],
];
const blankChecks = { phrase_exact: false, reference_consistent: false, no_synthetic_concerns: false, policy_acknowledged: false };
const copy = {
  mfa_required: 'Enter a fresh authenticator code, then retry.', self_review_forbidden: 'A reviewer cannot decide their own voice request.',
  evidence_not_viewed: 'Wait at least five seconds after opening the current evidence, then attest that it loaded.', evidence_not_delivered: 'Attest that the current evidence loaded before deciding.',
  state_conflict: 'This revision changed or was already decided. Refresh the queue.',
  not_admin: 'This account is not an administrator.', access_required: 'Complete the Cloudflare Access sign-in before opening this review queue.',
};
const message = (error) => copy[error?.code] || 'The review action was not confirmed. Refresh before retrying.';

export default function MusicVoiceReviewPage() {
  return <><AppNav /><Main><AccountBoundary><ReviewQueue /></AccountBoundary></Main></>;
}

function ReviewQueue() {
  const [profiles, setProfiles] = useState([]);
  const [evidence, setEvidence] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checks, setChecks] = useState(blankChecks);
  const [decision, setDecision] = useState('approve');
  const [reason, setReason] = useState('evidence_consistent');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const request = useRef(0);
  const attempts = useRef({});
  const load = useCallback(async () => {
    const id = ++request.current; setBusy('load'); setError(''); setEvidence(null); setAcknowledged(false);
    try { const result = await gatewayFetch('/admin/music/voices'); if (id === request.current) setProfiles(result.profiles || []); }
    catch (next) { if (id === request.current) setError(message(next)); }
    finally { if (id === request.current) setBusy(''); }
  }, []);
  useEffect(() => {
    // The protected queue exists only after the client has an administrator session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(); return () => { request.current += 1; };
  }, [load]);

  async function open(profile) {
    setBusy(profile.id); setError('');
    try {
      const result = await gatewayFetch(`/admin/music/voices/${profile.id}/evidence`, { method: 'POST',
        body: JSON.stringify({ submission_revision: profile.submission_revision }) });
      setEvidence({ ...result, name: profile.name }); setAcknowledged(false); setChecks(blankChecks); setDecision('approve'); setReason('evidence_consistent');
    } catch (next) { setError(message(next)); }
    finally { setBusy(''); }
  }
  async function acknowledge() {
    if (!evidence) return;
    setBusy('ack'); setError('');
    try {
      await gatewayFetch(`/admin/music/voices/${evidence.profile_id}/evidence/ack`, { method: 'POST',
        body: JSON.stringify({ submission_revision: evidence.submission_revision }) });
      setAcknowledged(true);
    } catch (next) { setError(message(next)); }
    finally { setBusy(''); }
  }
  async function decide() {
    if (!evidence || !acknowledged) return;
    setBusy('decision'); setError('');
    try {
      const input = { submission_revision: evidence.submission_revision, decision, reason_code: reason, checklist: checks };
      const signature = JSON.stringify(input);
      let attempt = attempts.current.review;
      if (!attempt || attempt.profileId !== evidence.profile_id || attempt.signature !== signature) {
        attempt = { profileId: evidence.profile_id, signature, idempotencyKey: `music-voice-review-${crypto.randomUUID()}` };
        attempts.current.review = attempt;
      }
      await gatewayFetch(`/admin/music/voices/${evidence.profile_id}/review`, { method: 'POST',
        headers: { 'idempotency-key': attempt.idempotencyKey }, body: JSON.stringify(input) });
      delete attempts.current.review;
      await load();
    } catch (next) { setError(message(next)); setBusy(''); }
  }
  const approvalReady = acknowledged && (decision === 'reject' || Object.values(checks).every(Boolean));

  return <div className="mx-auto max-w-5xl px-4 py-10 pb-32">
    <Link href="/app/admin" className="font-bold text-vx-accent underline underline-offset-4">Administration</Link>
    <h1 className="mt-5 text-4xl font-black">Music voice ownership review</h1>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-vx-fg-muted">Review the exact live phrase and compare both private recordings. Every evidence view and decision is audited; you cannot review your own request. Approval is owner-only during the launch gate; moderators can review and reject evidence.</p>
    <div className="mt-6"><MfaPanel requireFresh onVerified={load} /></div>
    <button type="button" disabled={busy === 'load'} onClick={load} className="mt-5 min-h-11 rounded-full border border-vx-accent px-5 font-bold text-vx-accent">{busy === 'load' ? 'Refreshing…' : 'Refresh review queue'}</button>
    {error ? <p role="alert" className="mt-5 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-4 text-sm text-vx-danger">{error}</p> : null}

    <section className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Pending music voice reviews">
      {profiles.length === 0 && busy !== 'load' ? <p role="status" className="rounded-2xl border border-dashed border-vx-border p-8 text-vx-fg-muted">No music voice reviews are waiting.</p> : null}
      {profiles.map((profile) => <article key={profile.id} className="rounded-2xl border border-vx-border bg-vx-panel p-5">
        <h2 className="text-xl font-black">{profile.name}</h2><p className="mt-2 text-xs text-vx-fg-muted">Revision {profile.submission_revision} · expires {new Date(profile.review_expires_at).toLocaleString()}</p>
        <button data-testid={`music-voice-evidence-${profile.id}`} type="button" disabled={Boolean(busy)} onClick={() => open(profile)} className="mt-4 min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy === profile.id ? 'Opening audited evidence…' : 'Review this evidence'}</button>
      </article>)}
    </section>

    {evidence ? <section data-testid="music-voice-review-panel" className="mt-8 rounded-2xl border border-vx-accent/40 bg-vx-panel p-5 sm:p-6">
      <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Audited evidence view · revision {evidence.submission_revision}</p>
      <h2 className="mt-2 text-2xl font-black">{evidence.name}</h2>
      <p className="mt-4 text-sm font-bold">Exact live phrase</p><p className="mt-2 rounded-xl bg-vx-base p-4 font-vx text-lg font-black leading-7">{evidence.phrase}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-bold">Reference recording<audio controls preload="none" src={evidence.reference_url} className="mt-2 w-full" /></label><label className="text-sm font-bold">Live challenge<audio controls preload="none" src={evidence.challenge_url} className="mt-2 w-full" /></label></div>
      <p className="mt-3 text-xs text-vx-fg-muted">Links expire in five minutes. {evidence.revocation_tail}</p>
      <p className="mt-4 text-xs text-vx-fg-muted">This is your delivery attestation, not proof that either recording was played. Confirm only after the phrase and both audio controls have loaded.</p>
      <button data-testid="music-voice-evidence-ack" type="button" disabled={Boolean(busy) || acknowledged} onClick={acknowledge} className="mt-3 min-h-11 rounded-full border border-vx-accent px-5 font-bold text-vx-accent disabled:opacity-40">{acknowledged ? 'Evidence delivery attested' : busy === 'ack' ? 'Recording attestation…' : 'Attest phrase and recordings loaded'}</button>
      <fieldset className="mt-6"><legend className="font-black">Required review checklist</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{[
        ['phrase_exact', 'The live recording says the exact phrase.'], ['reference_consistent', 'The reference and challenge voices are consistent.'],
        ['no_synthetic_concerns', 'I found no signs of synthetic or edited evidence.'], ['policy_acknowledged', 'The evidence satisfies the ownership policy.'],
      ].map(([key, label]) => <label key={key} className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={checks[key]} onChange={(event) => setChecks((value) => ({ ...value, [key]: event.target.checked }))} className="mt-1 h-5 w-5 accent-vx-accent" /><span>{label}</span></label>)}</div></fieldset>
      <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Decision<select value={decision} onChange={(event) => { const value = event.target.value; setDecision(value); if (value === 'approve') setReason('evidence_consistent'); else if (reason === 'evidence_consistent') setReason('policy_failed'); }} className="mt-2 min-h-11 w-full rounded-xl border border-vx-field bg-vx-base px-4"><option value="approve">Approve for 30 days</option><option value="reject">Reject and queue deletion</option></select></label><label className="text-sm font-bold">Reason<select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-field bg-vx-base px-4">{reasons.filter(([value]) => decision === 'approve' ? value === 'evidence_consistent' : value !== 'evidence_consistent').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <button data-testid="music-voice-review-submit" type="button" disabled={busy === 'decision' || !approvalReady} onClick={decide} className="mt-6 min-h-12 rounded-full bg-vx-accent px-6 font-black text-vx-accent-ink disabled:opacity-40">{busy === 'decision' ? 'Recording decision…' : 'Record audited decision'}</button>
    </section> : null}
  </div>;
}
