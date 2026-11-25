'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MfaPanel } from '../MfaPanel';
import { gatewayFetch } from '../../_lib/gateway';

const CONSENT_VERSION = 'music-own-voice-2026-11-24';
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']);
const MAX_BYTES = 20 * 1024 * 1024;
const card = 'rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-6';
const failureCopy = {
  recent_mfa_required: 'Verify with your authenticator, then retry.',
  mfa_required: 'Verify with your authenticator, then retry.',
  active_profile: 'Revoke the active voice before starting another.',
  challenge_expired: 'This phrase expired. Issue a new challenge.',
  challenge_mismatch: 'The submitted phrase did not match. Record the exact phrase and retry.',
  source_invalid: 'Use an MP3 or WAV recording within the stated duration and 20 MB limit.',
  reissue_limit: 'This voice has used every phrase refresh. Revoke it and start a new verification.',
  rate_limited: 'Too many voice verification attempts. Wait before starting another.',
};

function message(error) { return failureCopy[error?.code || error?.message] || 'The voice request could not be confirmed. Retry safely.'; }
function normalType(file) { return ['audio/x-wav', 'audio/wave'].includes(file?.type) ? 'audio/wav' : file?.type; }
async function uploadAudio(file) {
  if (!(file instanceof Blob) || !AUDIO_TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) throw new Error('source_invalid');
  const contentType = normalType(file);
  const grant = await gatewayFetch('/uploads', { method: 'POST', preserveUploadErrors: true,
    body: JSON.stringify({ content_type: contentType, size_bytes: file.size }) });
  const response = await fetch(grant.upload_url, { method: 'PUT', headers: grant.headers || { 'Content-Type': contentType }, body: file });
  if (!response.ok) throw new Error('upload_failed');
  return grant.key;
}

export function MusicVoices({ enrollmentInitiallyAvailable = false }) {
  const [profiles, setProfiles] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [name, setName] = useState('');
  const [reference, setReference] = useState(null);
  const [liveRecording, setLiveRecording] = useState(null);
  const [attestations, setAttestations] = useState({ owner: false, adult: false, region: false, live: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [enrollmentAvailable, setEnrollmentAvailable] = useState(enrollmentInitiallyAvailable);
  const request = useRef(0);
  const attempts = useRef({});

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const result = await gatewayFetch('/music/voices');
      if (id === request.current) { setProfiles(Array.isArray(result.profiles) ? result.profiles : []);
        setEnrollmentAvailable(result.policy?.enrollment_available === true); setError(''); }
    } catch (next) { if (id === request.current) setError(message(next)); }
  }, []);
  useEffect(() => {
    // Load after hydration; this screen has no server-owned account snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(); return () => { request.current += 1; };
  }, [load]);
  const active = profiles.find((profile) => ['challenge_issued', 'pending_review', 'verified'].includes(profile.status)) || null;
  const terminal = !active ? profiles.find((profile) => ['rejected', 'revoked', 'expired'].includes(profile.status)) || null : null;

  async function run(label, action) {
    setBusy(label); setError('');
    try { await action(); } catch (next) { setError(message(next)); }
    finally { setBusy(''); }
  }
  async function enroll(event) {
    event.preventDefault();
    await run('enroll', async () => {
      let attempt = attempts.current.enroll;
      if (!attempt) {
        const referenceKey = await uploadAudio(reference);
        attempt = { referenceKey, name: name.trim(), idempotencyKey: `music-voice-enroll-${crypto.randomUUID()}` };
        attempts.current.enroll = attempt;
      }
      const result = await gatewayFetch('/music/voices', { method: 'POST', body: JSON.stringify({
        name: attempt.name, reference_source_key: attempt.referenceKey, owner_attestation: attestations.owner,
        adult_attestation: attestations.adult, eligible_region_attestation: attestations.region,
        consent_version: CONSENT_VERSION, idempotency_key: attempt.idempotencyKey,
      }) });
      delete attempts.current.enroll;
      setChallenge(result.challenge || null); setName(''); setReference(null); await load();
    });
  }
  async function reissue() {
    if (!active) return;
    await run('challenge', async () => {
      let attempt = attempts.current.reissue;
      if (!attempt || attempt.profileId !== active.id) {
        attempt = { profileId: active.id, idempotencyKey: `music-voice-reissue-${crypto.randomUUID()}` };
        attempts.current.reissue = attempt;
      }
      const result = await gatewayFetch(`/music/voices/${active.id}/challenge`, { method: 'POST',
        body: JSON.stringify({ idempotency_key: attempt.idempotencyKey }) });
      delete attempts.current.reissue;
      setChallenge(result.challenge || null); await load();
    });
  }
  async function submit() {
    if (!active || !challenge?.phrase) return;
    await run('submit', async () => {
      let attempt = attempts.current.submit;
      if (!attempt || attempt.profileId !== active.id) {
        const challengeKey = await uploadAudio(liveRecording);
        attempt = { profileId: active.id, challengeKey, phrase: challenge.phrase,
          idempotencyKey: `music-voice-submit-${crypto.randomUUID()}` };
        attempts.current.submit = attempt;
      }
      await gatewayFetch(`/music/voices/${active.id}/verify`, { method: 'POST', body: JSON.stringify({
        challenge_source_key: attempt.challengeKey, phrase: attempt.phrase,
        live_recording_attestation: attestations.live,
        idempotency_key: attempt.idempotencyKey,
      }) });
      delete attempts.current.submit;
      setChallenge(null); setLiveRecording(null); setAttestations((value) => ({ ...value, live: false })); await load();
    });
  }
  async function revoke() {
    if (!active) return;
    await run('revoke', async () => {
      let attempt = attempts.current.revoke;
      if (!attempt || attempt.profileId !== active.id) {
        attempt = { profileId: active.id, idempotencyKey: `music-voice-revoke-${crypto.randomUUID()}` };
        attempts.current.revoke = attempt;
      }
      await gatewayFetch(`/music/voices/${active.id}`, { method: 'DELETE',
        headers: { 'idempotency-key': attempt.idempotencyKey } });
      delete attempts.current.revoke;
      setChallenge(null); setLiveRecording(null); await load();
    });
  }
  const setAttestation = (key, checked) => setAttestations((value) => ({ ...value, [key]: checked }));

  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Private voice ownership</p>
        <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Verify your music voice</h1>
        <p className="mt-3 max-w-2xl text-vx-fg-body">Prove that a reusable singing or rap voice belongs to you. Veyrnox reviews two private recordings; this does not create a provider persona.</p></div>
      <Link href="/app/music/library" className="text-sm font-bold text-vx-accent underline underline-offset-4">Back to Music Library</Link>
    </header>

    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {terminal ? <section data-testid={`music-voice-${terminal.status}`} className={card}>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Previous verification</p>
          <h2 className="mt-2 text-2xl font-black">{terminal.status === 'rejected' ? 'Not verified' : terminal.status === 'revoked' ? 'Voice revoked' : 'Verification expired'}</h2>
          <p className="mt-3 text-sm leading-6 text-vx-fg-muted">{terminal.status === 'rejected'
            ? `Review result: ${String(terminal.reason_code || 'policy_failed').replaceAll('_', ' ')}. You can submit a new reference below.`
            : terminal.status === 'revoked' ? 'The private recordings were queued for deletion. You can start again below.'
              : 'This verification is no longer active. You can start a new verification below.'}</p>
        </section> : null}
        {!active && enrollmentAvailable ? <form onSubmit={enroll} className={card}>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">1 · Reference</p>
          <h2 className="mt-2 text-2xl font-black">Add a recording of your own voice</h2>
          <p className="mt-2 text-sm leading-6 text-vx-fg-muted">Choose a clear 2-second to 5-minute MP3 or WAV recording where your voice is easy to identify.</p>
          <label className="mt-5 block text-sm font-bold">Voice name<input data-testid="music-voice-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-field bg-vx-base px-4" /></label>
          <label className="mt-5 block text-sm font-bold">Reference recording<input data-testid="music-voice-reference" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/wave" onChange={(event) => setReference(event.target.files?.[0] || null)} className="mt-2 block w-full font-normal" /></label>
          <div className="mt-5 space-y-3">{[
            ['owner', 'I confirm this is my own voice and recording.'], ['adult', 'I confirm I am at least 18 years old.'],
            ['region', 'I confirm voice verification is permitted where I live.'],
          ].map(([key, label]) => <label key={key} className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={attestations[key]} onChange={(event) => setAttestation(key, event.target.checked)} className="mt-1 h-5 w-5 accent-vx-accent" /><span>{label}</span></label>)}</div>
          <button data-testid="music-voice-enroll" disabled={busy || !name.trim() || !reference || !attestations.owner || !attestations.adult || !attestations.region} className="mt-6 min-h-12 rounded-full bg-vx-accent px-6 font-black text-vx-accent-ink disabled:opacity-40">{busy === 'enroll' ? 'Securing recording…' : 'Start private verification'}</button>
        </form> : null}
        {!active && !enrollmentAvailable ? <section data-testid="music-voice-enrollment-paused" className={card}>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Voice management remains available</p>
          <h2 className="mt-2 text-2xl font-black">New voice verification is paused</h2>
          <p className="mt-3 text-sm leading-6 text-vx-fg-muted">Existing voice status and consent withdrawal remain available while new enrollment is turned off.</p>
        </section> : null}

        {active?.status === 'challenge_issued' ? <section className={card}>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">2 · Live challenge</p>
          <h2 className="mt-2 text-2xl font-black">Record the exact phrase now</h2>
          {!challenge ? <><p className="mt-3 text-sm leading-6 text-vx-fg-muted">For privacy, a phrase is shown only when issued. Generate a new one after a reload.</p><button data-testid="music-voice-new-challenge" disabled={busy} onClick={reissue} className="mt-5 min-h-11 rounded-full border border-vx-accent px-5 font-bold text-vx-accent">Issue a new phrase</button></>
            : <><p data-testid="music-voice-phrase" className="mt-5 rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-5 font-vx text-xl font-black leading-8">{challenge.phrase}</p>
              <p className="mt-3 text-sm leading-6 text-vx-fg-muted">Upload a fresh, unedited recording made after this phrase was issued. This is your attestation; an authorized person reviews the phrase and voice consistency.</p>
              <label className="mt-5 block text-sm font-bold">Fresh challenge recording<input data-testid="music-voice-live-recording" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/wave" onChange={(event) => setLiveRecording(event.target.files?.[0] || null)} className="mt-2 block w-full font-normal" /></label>
              <label className="mt-4 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={attestations.live} onChange={(event) => setAttestation('live', event.target.checked)} className="mt-1 h-5 w-5 accent-vx-accent" /><span>I recorded this challenge live after the phrase was issued.</span></label>
              <button data-testid="music-voice-submit" type="button" disabled={busy || !liveRecording || !attestations.live} onClick={submit} className="mt-6 min-h-12 rounded-full bg-vx-accent px-6 font-black text-vx-accent-ink disabled:opacity-40">{busy === 'submit' ? 'Submitting securely…' : 'Submit for human review'}</button></>}
        </section> : null}

        {active?.status === 'pending_review' ? <section data-testid="music-voice-pending" className={card}><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Review pending</p><h2 className="mt-2 text-2xl font-black">Your recordings are in the private review queue</h2><p className="mt-3 text-sm leading-6 text-vx-fg-muted">A different authorized reviewer checks the phrase and voice consistency. The request expires after seven days if it is not decided.</p></section> : null}
        {active?.status === 'verified' ? <section data-testid="music-voice-verified" className={card}><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Verified</p><h2 className="mt-2 text-2xl font-black">{active.name}</h2><p className="mt-3 text-sm text-vx-fg-muted">Ownership verification expires {active.verification_expires_at ? new Date(active.verification_expires_at).toLocaleDateString() : 'after 30 days'}.</p></section> : null}
        {error ? <p role="alert" className="rounded-2xl border border-vx-danger/40 bg-vx-danger/10 p-4 text-sm text-vx-danger">{error}</p> : null}
      </div>

      <aside className="space-y-6 lg:sticky lg:top-24"><MfaPanel requireFresh onVerified={load} /><section className={card}><h2 className="font-black">Privacy and control</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-vx-fg-muted"><li>Only private recordings you upload are reviewed.</li><li>No biometric template or provider persona is created here.</li><li>You can revoke at any time; deletion waits only for an already-issued upload grant to expire.</li></ul>{active ? <button data-testid="music-voice-revoke" disabled={busy} onClick={revoke} className="mt-5 min-h-11 w-full rounded-full border border-vx-danger px-5 font-bold text-vx-danger disabled:opacity-40">{busy === 'revoke' ? 'Revoking…' : 'Revoke and delete recordings'}</button> : null}</section></aside>
    </div>
  </div>;
}
