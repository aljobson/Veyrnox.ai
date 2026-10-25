'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { getSession, onSessionChange } from '../../lib/authClient';
import { gatewayDownload, gatewayFetch } from '../_lib/gateway';
import { MfaPanel } from './MfaPanel';

const CONSENT_VERSION = 'voice-owner-2026-10-25';
const MIN_SECONDS = 30 * 60;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']);
const card = 'rounded-2xl border border-vx-border bg-vx-panel';

function normalType(file) {
  return ['audio/x-wav', 'audio/wave'].includes(file?.type) ? 'audio/wav' : file?.type;
}

function durationLabel(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

async function uploadPrivateAudio(file) {
  const type = normalType(file);
  if (!(file instanceof Blob) || !AUDIO_TYPES.has(file.type) || !file.size || file.size > MAX_FILE_BYTES) {
    throw new Error('file_invalid');
  }
  const grant = await gatewayFetch('/uploads', {
    method: 'POST',
    body: JSON.stringify({ content_type: type, size_bytes: file.size }),
  });
  const sent = await fetch(grant.upload_url, {
    method: 'PUT', headers: grant.headers || { 'Content-Type': grant.content_type }, body: file,
  });
  if (!sent.ok) throw new Error('upload_failed');
  return grant.key;
}

export default function VoiceCloneStudio() {
  const { t } = useI18n();
  const [signedIn, setSignedIn] = useState(null);
  const [available, setAvailable] = useState(null);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [attested, setAttested] = useState(false);
  const [sample, setSample] = useState(null);
  const [verification, setVerification] = useState(null);
  const [captchaUrl, setCaptchaUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [speechText, setSpeechText] = useState('');
  const [speechJob, setSpeechJob] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await gatewayFetch('/voice-profiles');
      setAvailable(result.available === true);
      setSpeechAvailable(result.speech_available === true);
      setProfiles(Array.isArray(result.profiles) ? result.profiles : []);
      setError('');
    } catch (err) {
      setError(err?.code ? String(err.code) : t('app.voiceClone.profilesUnavailable'));
    }
  }, [t]);

  useEffect(() => {
    const update = () => setSignedIn(Boolean(getSession()?.access_token));
    update();
    return onSessionChange(update);
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    // Load the first authenticated snapshot after session discovery.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, signedIn]);
  useEffect(() => () => { if (captchaUrl) URL.revokeObjectURL(captchaUrl); }, [captchaUrl]);

  const profile = profiles.find((item) => item.status !== 'revoked') || profiles[0] || null;
  const progress = Math.min(100, Math.round(((Number(profile?.sample_seconds) || 0) / MIN_SECONDS) * 100));

  async function run(label, action) {
    setBusy(label); setError('');
    try { await action(); }
    catch (err) {
      const failure = err?.code || err?.message;
      setError(failure ? String(failure) : t('app.voiceClone.requestFailed'));
    }
    finally { setBusy(''); }
  }

  async function createProfile() {
    await run('create', async () => {
      await gatewayFetch('/voice-profiles', { method: 'POST', body: JSON.stringify({
        name, language, owner_attestation: attested, consent_version: CONSENT_VERSION,
      }) });
      setName(''); setAttested(false); await load();
    });
  }

  async function addSample() {
    if (!profile || !sample) return;
    await run('sample', async () => {
      const sourceKey = await uploadPrivateAudio(sample);
      await gatewayFetch(`/voice-profiles/${profile.id}/samples`, {
        method: 'POST', body: JSON.stringify({ source_key: sourceKey }),
      });
      setSample(null); await load();
    });
  }

  async function openVerification() {
    if (!profile) return;
    await run('captcha', async () => {
      const result = await gatewayDownload(`/voice-profiles/${profile.id}/captcha`);
      const next = URL.createObjectURL(result.blob);
      if (captchaUrl) URL.revokeObjectURL(captchaUrl);
      setCaptchaUrl(next); await load();
    });
  }

  async function verifyAndTrain() {
    if (!profile || !verification) return;
    await run('verify', async () => {
      const sourceKey = await uploadPrivateAudio(verification);
      await gatewayFetch(`/voice-profiles/${profile.id}/captcha`, {
        method: 'POST', body: JSON.stringify({ source_key: sourceKey }),
      });
      setVerification(null);
      if (captchaUrl) URL.revokeObjectURL(captchaUrl);
      setCaptchaUrl(''); await load();
    });
  }

  async function refreshStatus() {
    if (!profile) return;
    await run('refresh', async () => {
      await gatewayFetch(`/voice-profiles/${profile.id}`); await load();
    });
  }

  async function revoke() {
    if (!profile) return;
    await run('revoke', async () => {
      await gatewayFetch(`/voice-profiles/${profile.id}`, { method: 'DELETE' }); await load();
    });
  }

  async function generateSpeech() {
    if (!profile || profile.status !== 'ready') return;
    await run('speech', async () => {
      const result = await gatewayFetch(`/voice-profiles/${profile.id}/speech`, {
        method: 'POST',
        body: JSON.stringify({ text: speechText, idempotency_key: `voice-${crypto.randomUUID()}` }),
      });
      setSpeechJob(result.job_id || '');
      setSpeechText('');
    });
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="space-y-6">
        <header className={`${card} p-6 sm:p-8`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.voiceClone.eyebrow')}</p>
          <h1 className="vx-display mt-4 text-[42px] leading-[0.95] sm:text-[58px]">{t('app.voiceClone.title')}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-vx-fg-muted">{t('app.voiceClone.intro')}</p>
        </header>

        {signedIn === false && <section className={`${card} p-5 sm:p-6`}>
          <p className="text-sm font-black">{t('app.voiceClone.signInTitle')}</p>
          <p className="mt-2 text-sm leading-6 text-vx-fg-muted">{t('app.voiceClone.signInBody')}</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))} className="mt-5 min-h-11 rounded-full bg-vx-accent px-5 text-sm font-black text-vx-accent-ink">{t('app.voiceClone.signInAction')}</button>
        </section>}

        {signedIn && available === false && <section className={`${card} border-vx-danger/35 p-5 sm:p-6`}>
          <p className="text-sm font-black text-vx-danger">{t('app.voiceClone.unavailableTitle')}</p>
          <p className="mt-2 text-sm leading-6 text-vx-fg-muted">{t('app.voiceClone.unavailableBody')}</p>
        </section>}

        {signedIn && <MfaPanel requireFresh onVerified={load} />}

        {signedIn && !profile && <section className={`${card} p-5 sm:p-6`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">01 · {t('app.voiceClone.create')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_160px]">
            <label className="text-sm font-bold">{t('app.voiceClone.name')}<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-vx-field bg-vx-base px-4 py-3 font-normal" /></label>
            <label className="text-sm font-bold">{t('app.voiceClone.language')}<select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full rounded-xl border border-vx-field bg-vx-base px-4 py-3 font-normal"><option value="en">{t('app.voiceClone.language.en')}</option><option value="es">{t('app.voiceClone.language.es')}</option><option value="fr">{t('app.voiceClone.language.fr')}</option><option value="de">{t('app.voiceClone.language.de')}</option><option value="pt">{t('app.voiceClone.language.pt')}</option><option value="it">{t('app.voiceClone.language.it')}</option><option value="pl">{t('app.voiceClone.language.pl')}</option><option value="hi">{t('app.voiceClone.language.hi')}</option><option value="ja">{t('app.voiceClone.language.ja')}</option><option value="ko">{t('app.voiceClone.language.ko')}</option></select></label>
          </div>
          <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="mt-1 h-5 w-5 accent-vx-accent" /><span>{t('app.voiceClone.attestation')}</span></label>
          <button type="button" disabled={!available || busy || !name.trim() || !attested} onClick={createProfile} className="mt-5 min-h-12 rounded-full bg-vx-accent px-6 text-sm font-black text-vx-accent-ink disabled:opacity-45">{busy === 'create' ? t('app.voiceClone.working') : t('app.voiceClone.createAction')}</button>
        </section>}

        {profile?.status === 'samples_pending' && <section className={`${card} p-5 sm:p-6`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">02 · {t('app.voiceClone.samples')}</p>
          <h2 className="mt-2 text-xl font-black">{profile.name}</h2>
          <p className="mt-3 text-sm leading-6 text-vx-fg-muted">{t('app.voiceClone.samplesHelp')}</p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-vx-base"><div className="h-full bg-vx-accent" style={{ width: `${progress}%` }} /></div>
          <p className="mt-2 font-vx-mono text-xs text-vx-fg-muted">{durationLabel(profile.sample_seconds)} / 30:00 · {profile.sample_count || 0} {t('app.voiceClone.clips')}</p>
          <input type="file" accept="audio/mpeg,audio/wav" onChange={(event) => setSample(event.target.files?.[0] || null)} className="mt-5 block w-full text-sm" />
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={!sample || busy} onClick={addSample} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-black text-vx-accent-ink disabled:opacity-45">{busy === 'sample' ? t('app.voiceClone.working') : t('app.voiceClone.addSample')}</button>
            <button type="button" disabled={Number(profile.sample_seconds) < MIN_SECONDS || busy} onClick={openVerification} className="min-h-11 rounded-full border border-vx-accent px-5 text-sm font-black text-vx-accent disabled:opacity-45">{busy === 'captcha' ? t('app.voiceClone.working') : t('app.voiceClone.verifyAction')}</button>
          </div>
        </section>}

        {profile?.status === 'verification_pending' && <section className={`${card} p-5 sm:p-6`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">03 · {t('app.voiceClone.verify')}</p>
          {!captchaUrl && <button type="button" disabled={busy} onClick={openVerification} className="mt-4 min-h-11 rounded-full border border-vx-accent px-5 text-sm font-black text-vx-accent">{t('app.voiceClone.showPhrase')}</button>}
          {captchaUrl && <div className="mt-5 rounded-xl border border-vx-border bg-white p-4"><img src={captchaUrl} alt={t('app.voiceClone.phraseAlt')} className="max-w-full" /></div>}
          <p className="mt-4 text-sm leading-6 text-vx-fg-muted">{t('app.voiceClone.verifyHelp')}</p>
          <input type="file" accept="audio/mpeg,audio/wav" onChange={(event) => setVerification(event.target.files?.[0] || null)} className="mt-4 block w-full text-sm" />
          <button type="button" disabled={!captchaUrl || !verification || busy} onClick={verifyAndTrain} className="mt-5 min-h-12 rounded-full bg-vx-accent px-6 text-sm font-black text-vx-accent-ink disabled:opacity-45">{busy === 'verify' ? t('app.voiceClone.working') : t('app.voiceClone.submitVerification')}</button>
        </section>}

        {['training', 'ready', 'failed'].includes(profile?.status) && <section className={`${card} p-5 sm:p-6`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">04 · {t('app.voiceClone.status')}</p>
          <h2 className="mt-2 text-xl font-black capitalize">{profile.status}</h2>
          <p className="mt-3 text-sm leading-6 text-vx-fg-muted">{profile.status === 'ready' ? t('app.voiceClone.ready') : profile.status === 'failed' ? t('app.voiceClone.failed') : t('app.voiceClone.training')}</p>
          {profile.error_code && <code className="mt-3 block text-xs text-vx-danger">{profile.error_code}</code>}
          {profile.status === 'training' && <button type="button" disabled={busy} onClick={refreshStatus} className="mt-5 min-h-11 rounded-full border border-vx-accent px-5 text-sm font-black text-vx-accent">{busy === 'refresh' ? t('app.voiceClone.working') : t('app.voiceClone.refresh')}</button>}
        </section>}

        {profile?.status === 'ready' && <section className={`${card} p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-4">
            <div><p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">05 · {t('app.voiceClone.speak')}</p><h2 className="mt-1 text-xl font-black">{t('app.voiceClone.speakTitle')}</h2></div>
            <span className="font-vx-mono text-[10px] text-vx-fg-faint">{speechText.length}/1000</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-vx-fg-muted">{t('app.voiceClone.speakHelp')}</p>
          <textarea value={speechText} maxLength={1000} rows={6} onChange={(event) => { setSpeechText(event.target.value); setSpeechJob(''); }} placeholder={t('app.voiceClone.speakPlaceholder')} className="mt-4 w-full resize-y rounded-xl border border-vx-field bg-vx-base px-4 py-3 text-sm focus:border-vx-accent focus:outline-hidden" />
          {!speechAvailable && <p role="status" className="mt-3 rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-xs leading-5 text-vx-fg-muted">{t('app.voiceClone.speakUnavailable')}</p>}
          <button type="button" disabled={!speechAvailable || !speechText.trim() || busy} onClick={generateSpeech} className="mt-5 min-h-12 rounded-full bg-vx-accent px-6 text-sm font-black text-vx-accent-ink disabled:opacity-45">{busy === 'speech' ? t('app.voiceClone.working') : t('app.voiceClone.speakAction')}</button>
          <p className="mt-3 text-xs text-vx-fg-muted">{t('app.voiceClone.speakPrice')}</p>
          {speechJob && <div role="status" className="mt-4 rounded-xl border border-vx-accent/40 bg-vx-accent/[0.06] px-4 py-3 text-sm"><p className="font-black">{t('app.voiceClone.speakDone')}</p><Link href="/app/library" className="mt-2 inline-block font-bold text-vx-accent underline underline-offset-4">{t('app.voiceClone.openLibrary')}</Link></div>}
        </section>}

        {error && <p role="alert" className="rounded-xl border border-vx-danger/35 bg-vx-danger/[0.06] px-4 py-3 text-sm text-vx-danger">{t('app.voiceClone.error', { code: error })}</p>}
      </div>

      <aside className={`${card} p-5 xl:sticky xl:top-24`}>
        <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.voiceClone.safety')}</p>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-vx-fg-muted"><li>{t('app.voiceClone.safetyOwner')}</li><li>{t('app.voiceClone.safetyMfa')}</li><li>{t('app.voiceClone.safetyPrivate')}</li><li>{t('app.voiceClone.safetyRevoke')}</li></ul>
        {profile && profile.status !== 'revoked' && <button type="button" disabled={busy} onClick={revoke} className="mt-6 min-h-11 w-full rounded-full border border-vx-danger px-5 text-sm font-black text-vx-danger disabled:opacity-45">{busy === 'revoke' ? t('app.voiceClone.working') : t('app.voiceClone.revoke')}</button>}
      </aside>
    </div>
  );
}
