'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';

import Link from 'next/link';
import { CreatorApplication } from './CreatorApplication';
import { CinemaCollection } from './CinemaRetention';
import { CinemaWinners } from './CinemaWinners';
import { CinemaDiscovery } from './CinemaDiscovery';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../_components/Button';
import { getSession, onSessionChange } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { useCinemaPreview } from './preview';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';

const sections = (t) => [[t("cinema.socialCinema.series")], [t("cinema.socialCinema.vote")], [t("cinema.socialCinema.saved")], [t("cinema.socialCinema.following")], [t("cinema.socialCinema.winners")]];

export function SocialCinema() {
  const { t } = useI18n();
  const [section, setSection] = useState(0);
  const [viewingOpen, setViewingOpen] = useState(false);
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const preview = useCinemaPreview();
  return <div className="mx-auto max-w-[1300px] px-4 py-10 pb-40 sm:px-6 sm:py-16 sm:pb-32"><div className="max-w-[1052px]">
    <header className="max-w-2xl">
      <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">{t('cinema.kicker')}{viewingOpen ? '' : t("cinema.socialCinema.inDevelopment")}</p>
      <h1 className="vx-display vx-title-detail">{t("cinema.socialCinema.storiesWorth")}<br />{t("cinema.socialCinema.comingBackFor")}</h1>
      <p className="mt-6 text-lg leading-relaxed text-vx-fg-body">{t("cinema.socialCinema.originalEpisodesOngoingSeriesAnAudience")}</p>
      <p className="mt-3 text-sm text-vx-fg-muted">{viewingOpen ? t("cinema.socialCinema.chooseASeriesAndWatchEvery") : t("cinema.socialCinema.weReBuildingSocialCinemaOn")}</p>
    </header>
    <nav aria-label={t("label.Social Cinema")} className="mt-10 flex gap-1 overflow-x-auto border-b border-vx-border pb-3">
      {sections(t).map(([label], index) => <button key={label} type="button"
        aria-current={section === index ? 'page' : undefined} onClick={() => setSection(index)}
        className={`shrink-0 rounded-full px-5 py-3 text-sm font-bold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent ${section === index ? 'bg-vx-accent text-vx-accent-ink' : 'text-vx-fg-muted hover:bg-vx-panel'}`}>{label}</button>)}
    </nav>
    {section === 4 ? <CinemaWinners /> : section === 2 ? <CinemaCollection kind="saved" /> : section === 3 ? <Following /> : <CinemaDiscovery mode={section === 1 ? 'voting' : 'series'} onAvailability={section === 1 ? undefined : setViewingOpen} />}
    {preview && <section className="border-t border-vx-border pt-8" aria-labelledby="profile-title">
      <h2 id="profile-title" className="text-xl font-extrabold">{t("cinema.socialCinema.yourSocialCinemaProfile")}</h2>
      {account ? <Profile key={account} /> : <div className="mt-4"><p className="mb-4 text-vx-fg-body">{t("cinema.socialCinema.useYourVeyrnoxAiAccountTo")}</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</Button></div>}
    </section>}
  </div></div>;
}

function Profile() {
  const { t, href: localize } = useI18n();

  const [profile, setProfile] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef(null);
  useEffect(() => {
    let active = true;
    setState('loading');
    gatewayFetch('/social-cinema/profile').then(data => {
      if (active) { setProfile(data.profile); setState('ready'); }
    }).catch(e => {
      if (active) { setError(message(e.code, t)); setState(e.code === 'profiles_not_open' ? 'closed' : 'error'); }
    });
    return () => { active = false; };
  }, [attempt, t]);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ username: form.get('username'), display_name: form.get('display_name'), bio: form.get('bio') });
    if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
    setState('saving'); setError('');
    try {
      await gatewayFetch('/social-cinema/profile', { method: 'POST', body, headers: { 'idempotency-key': request.current.key } });
      setAttempt(n => n + 1);
    } catch (e) {
      if (e.code === 'profile_exists') { setAttempt(n => n + 1); return; }
      setError(message(e.code, t)); setState('ready');
    }
  }
  if (state === 'loading') return <p role="status" className="mt-4 text-vx-fg-muted">{t("cinema.socialCinema.loadingYourProfile")}</p>;
  if (state === 'closed' || state === 'error') return <div className="mt-4"><p role="status">{error}</p>{state === 'error' && <Button className="mt-4" onClick={() => setAttempt(n => n + 1)}>{t("recovery.retry")}</Button>}</div>;
  if (profile) return <><div className="mt-5 rounded-2xl border border-vx-border p-6"><h3 className="text-xl font-bold">{profile.display_name}</h3><p className="mt-1 text-vx-accent">@{profile.username}</p><p className="mt-4 whitespace-pre-wrap wrap-break-word text-vx-fg-body">{profile.bio}</p><p className="mt-5 text-sm text-vx-fg-muted">{t("cinema.socialCinema.yourProfileIsSavedPublishingAnd")}</p></div><CreatorApplication />{profile.role === 'creator' && <Link href={localize("/social-cinema/creator")} className="mt-6 inline-flex rounded-full border border-vx-border px-5 py-3 font-bold text-vx-accent">{t("cinema.socialCinema.openCreatorWorkspace")}</Link>}</>;
  const input = 'mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-vx-fg focus:outline-solid focus:outline-2 focus:outline-vx-accent';
  return <form onSubmit={submit} className="mt-4 max-w-lg space-y-5">
    <p className="text-sm text-vx-fg-body">{t("cinema.socialCinema.yourUsernameDisplayNameAndBio")}</p>
    <label className="block text-sm font-semibold" htmlFor="cinema-username">{t("cinema.socialCinema.username")}<input id="cinema-username" name="username" required minLength={3} maxLength={30} pattern="[a-z][a-z0-9_]{2,29}" autoCapitalize="none" autoCorrect="off" className={input} aria-describedby="username-help" /></label>
    <p id="username-help" className="text-xs text-vx-fg-muted">{t("cinema.socialCinema.330LowercaseLettersNumbersOr")}</p>
    <label className="block text-sm font-semibold" htmlFor="cinema-name">{t("cinema.socialCinema.displayName")}<input id="cinema-name" name="display_name" required maxLength={80} className={input} /></label>
    <label className="block text-sm font-semibold" htmlFor="cinema-bio">{t("cinema.socialCinema.bio")}{' '}<span className="font-normal">{t("cinema.socialCinema.optional")}</span><textarea id="cinema-bio" name="bio" maxLength={500} rows={3} className={input} /></label>
    {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <Button type="submit" disabled={state === 'saving'}>{state === 'saving' ? t("social.saving") : t("cinema.socialCinema.createMyProfile")}</Button>
  </form>;
}
function message(code, t) {
  return ({ account_not_active: t("cinema.socialCinema.yourCinemaAccountIsRestrictedContact"), profiles_not_open: t("cinema.socialCinema.profileRegistrationIsNotOpenYet"), username_unavailable: t("cinema.socialCinema.thatUsernameIsTakenTryAnother"),
    invalid_profile: t("cinema.socialCinema.checkYourUsernameAndDisplayName"), rate_limited: t("cinema.creatorApplication.tooManyRequestsWaitAMinute"),
    idempotency_conflict: t("cinema.socialCinema.thisAttemptChangedReloadToCheck") })[code]
    || t("cinema.socialCinema.weCouldNotLoadOrSave");
}

function Following() {
  const { t } = useI18n();
  const [kind, setKind] = useState('creator');
  return <><nav aria-label={t("cinema.socialCinema.followedStories")} className="mt-6 flex gap-3">
    {[['creator', t("cinema.socialCinema.creators")], ['series', t("cinema.socialCinema.series")]].map(([value, label]) =>
      <Button key={value} data-testid={`follow-${value}-tab`} variant="ghost" aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</Button>)}
  </nav><CinemaCollection kind={kind} /></>;
}
