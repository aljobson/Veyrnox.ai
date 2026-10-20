'use client';
import BindingText from '../../../../../components/BindingText';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { rich } from '../../../../../lib/i18n/rich';
import { useI18n } from '../../../../../components/I18nProvider.jsx';

import Link from 'next/link';
import { CinemaComments } from '../../CinemaComments';
import { CinemaVoting } from '../../CinemaVoting.js';
import { CinemaRetentionControls } from '../../CinemaRetention';
import { CinemaShare } from '../../CinemaShare';
import { CinemaPoster } from '../../CinemaPoster';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../../../_components/Button';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { gatewayFetch, notifyBalanceChanged } from '../../../_lib/gateway';
import { cinemaDescription } from '../../../_lib/cinemaDescription';
import { editorialSeriesForEpisode } from '../../editorialSeries';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const minutes = (s, t) => (s ? t('cinema.duration', { n: Math.max(1, Math.round(s / 60)) }) : '');
// The wording the Unlock consent version stands for. A change needs a new version on both sides.
const CONSENT_TEXT = 'Unlock now and add it to my account for good. I understand this spends credits straight away and that my right to cancel ends once I press play.';

export function TitlePage({ id }) {
  const { t, href: localize } = useI18n();

  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [title, setTitle] = useState(null);
  const [state, setState] = useState('loading');
  const [consentVersion, setConsentVersion] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!UUID.test(id)) { setState('missing'); return; }
    setState('loading');
    try {
      const data = account ? await gatewayFetch(`/cinema/titles/${id}`) : await fetch(`/api/cinema/titles/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error('failed'), { status: r.status }))));
      setTitle(data.title); setState('ready');
      if (account) { try { setConsentVersion((await gatewayFetch(`/cinema/entitlement?content_id=${id}`)).consent_version); } catch { /* the consent version rides on any entitlement read; the first unlock will ask again */ } }
    } catch (err) { setState(err?.status === 404 || err?.status === 400 ? 'missing' : err?.status === 503 ? 'closed' : 'error'); }
  }, [id, account]);
  useEffect(() => { load(); }, [load]);

  const unlock = async (item) => {
    if (!account) { window.dispatchEvent(new CustomEvent('veyrnox:auth-required')); return; }
    setBusy(item.id); setNotice('');
    try {
      let version = consentVersion;
      if (!version) version = (await gatewayFetch(`/cinema/entitlement?content_id=${item.id}`)).consent_version;
      const r = await gatewayFetch('/cinema/unlocks', { method: 'POST', body: JSON.stringify({ content_id: item.id, consent_version: version }) });
      notifyBalanceChanged();
      setNotice(r.access === 'unlocked' ? `${t('cinema.title.unlocked')} ${r.balance_after != null ? t('cinema.title.balance', { count: r.balance_after }) : ''}` : t("cinema.titlePage.thisOneIsFree"));
      await load();
    } catch (err) {
      setNotice(err?.code === 'insufficient_credits' ? t("cinema.titlePage.notEnoughCreditsTopUpFrom") : err?.code === 'account_frozen' ? t("cinema.passPanel.yourAccountIsPausedContactSupport") : t("cinema.titlePage.couldNotUnlockRightNowTry"));
    } finally { setBusy(''); }
  };

  if (state === 'loading') return <div className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6"><p role="status" className="text-vx-fg-muted">{t("cinema.titlePage.loading")}</p></div>;
  if (state !== 'ready') return <div className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6"><p role="status">{state === 'missing' ? t("cinema.titlePage.thisTitleIsNotAvailable") : state === 'closed' ? t("cinema.discovery.socialCinemaViewingIsNotOpen") : t("cinema.titlePage.couldNotLoadThisTitleTry")}</p><Link href={localize("/social-cinema")} className="mt-6 inline-block underline">{t("cinema.back")}</Link></div>;

  const playable = (item) => ['free', 'unlocked', 'pass'].includes(item.access);
  const renderItem = (item, label) => {
    const membership = editorialSeriesForEpisode(item.id);
    const watchHref = membership ? `/social-cinema/watch/${item.id}?series=${membership.series.slug}` : `/social-cinema/watch/${item.id}?title_id=${id}`;
    return <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
    <div className="min-w-0 flex-1">
      <p className="font-bold wrap-break-word">{label}{item.title}</p>
      {cinemaDescription(item.synopsis) && <p className="mt-1 line-clamp-2 text-sm text-vx-fg-body wrap-break-word">{cinemaDescription(item.synopsis)}</p>}
      <p className="mt-1 font-vx-mono text-xs text-vx-fg-muted">{minutes(item.duration_seconds, t)}{item.access === 'free' ? t("cinema.titlePage.free") : item.access === 'unlocked' ? t("cinema.titlePage.unlocked") : item.access === 'pass' ? t('cinema.title.passAccess') : item.reason === 'pass_ceiling' ? t("cinema.titlePage.passLimitReachedThisMonth") : ''}</p>
    </div>
    {playable(item) ? <Link href={localize(watchHref)} className="rounded-full bg-vx-accent px-5 py-2 text-sm font-bold text-vx-accent-ink">{t("cinema.titlePage.play")}</Link>
      : <Button size="sm" disabled={busy === item.id || (account && !agreed)} onClick={() => unlock(item)}>{account ? t('cinema.title.unlock', { count: item.credits }) : t("cinema.titlePage.signInToUnlock")}</Button>}
    </li>;
  };
  const locked = title.content_type === 'SERIES' ? title.seasons.some((s) => s.episodes.some((e) => e.access === 'locked')) : title.access === 'locked';
  const editorialMembership = editorialSeriesForEpisode(title.id);

  return <div className="mx-auto max-w-[1300px] px-4 py-10 pb-40 sm:px-6 sm:py-16 sm:pb-32"><div className="max-w-[952px]">
    <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">{editorialMembership ? t('cinema.title.kicker', { detail: t('cinema.title.position', { season: editorialMembership.series.season, episode: editorialMembership.episode.position }) }) : t('cinema.title.kicker', { detail: tOr(t, `cinema.type.${title.content_type}`, title.content_type) }).toUpperCase()}</p>
    <CinemaPoster id={title.id} title={title.title} eager sizes="(min-width: 1024px) 952px, 100vw" className="mb-8" />
    <h1 className="vx-display vx-title-detail wrap-break-word">{title.title}</h1>
    {editorialMembership && <p className="mt-3 text-sm"><Link href={localize(`/social-cinema/series/${editorialMembership.series.slug}`)} className="font-bold text-vx-accent underline">{editorialMembership.series.title}</Link> · {t('cinema.title.position', { season: editorialMembership.series.season, episode: editorialMembership.episode.position })}</p>}
    <p className="mt-3 text-vx-fg-muted">{rich(t('cinema.title.by'), { creator: <Link href={localize('/social-cinema')} className="underline">{title.creator?.display_name}</Link> })} · {title.language}{title.categories?.length ? ` · ${title.categories.map(slug => tOr(t, `cinema.category.${slug}`, slug)).join(', ')}` : ''}{title.ai_disclosures?.length ? t('cinema.title.aiDisclosures', { disclosures: title.ai_disclosures.map(code => tOr(t, `cinema.disclosure.${code}`, code)).join(', ') }) : ''}</p>
    {cinemaDescription(title.synopsis) && <p className="mt-6 max-w-2xl leading-relaxed text-vx-fg-body wrap-break-word">{cinemaDescription(title.synopsis)}</p>}
    <CinemaShare key={id} id={id} title={title.title} />
    <CinemaRetentionControls contentId={id} />
    {notice && <p role="status" aria-live="polite" className="mt-6 rounded-lg border border-vx-border bg-vx-base/60 px-4 py-3 text-sm">{notice}</p>}
    {locked && account && <div className="mt-8 rounded-2xl border border-vx-border p-5">
      <BindingText id="unlock"  ><label className="flex items-start gap-3 text-sm text-vx-fg-body"><input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span lang="en" dir="ltr">{CONSENT_TEXT}</span></label></BindingText>
      <p className="mt-3 text-sm text-vx-fg-muted">{rich(t('cinema.title.passLink'), { pass: <Link href={localize('/social-cinema/pass')} className="underline">{t('label.Cinema Pass')}</Link> })}</p>
    </div>}
    {title.content_type === 'SERIES' ? title.seasons.map((s) => <section key={s.id} className="mt-10" aria-labelledby={`season-${s.id}`}>
      <h2 id={`season-${s.id}`} className="text-xl font-extrabold">{t('cinema.title.season', { number: s.position })}{s.title && s.title !== title.title ? `: ${s.title}` : ''}</h2>
      <ul className="mt-2 divide-y divide-vx-border border-y border-vx-border">{s.episodes.map((e) => renderItem(e, `${e.position}. `))}</ul>
    </section>) : <ul className="mt-10 border-y border-vx-border">{renderItem(title, '')}</ul>}
    <CinemaVoting contentId={id} /><CinemaComments contentId={id} />
    <p className="mt-10 text-sm">{editorialMembership && <><Link href={localize(`/social-cinema/series/${editorialMembership.series.slug}`)} className="underline">{t('cinema.backTitle', { title: editorialMembership.series.title })}</Link> · </>}<Link href={localize("/social-cinema")} className="underline">{t("label.Social Cinema")}</Link></p>
  </div></div>;
}
