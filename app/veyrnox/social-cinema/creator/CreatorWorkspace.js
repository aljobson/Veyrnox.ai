'use client';
import BindingText, { BindingPolicyLink } from '../../../../components/BindingText';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider.jsx';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { VideoUpload } from './VideoUpload';
import { CreatorAnalytics } from './CreatorAnalytics';
import { Button } from '../../_components/Button';
import { AI_DISCLOSURES, CINEMA_CATEGORIES, MAX_CATEGORIES } from '../../../../lib/cinema/domain';
import { CINEMA_POLICY_VERSION, CINEMA_RATINGS, CINEMA_WARNING_CODES } from '../../../../lib/cinema/safetyPolicy';
import { useCinemaPreview } from '../preview';
const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const stateLabels = (t) => ({ DRAFT: t("cinema.creatorWorkspace.privateDraft"), UNDER_REVIEW: t("cinema.creatorWorkspace.underReview"), PUBLISHED: t("cinema.creatorWorkspace.published"), SUSPENDED: t("cinema.creatorWorkspace.suspended") });
// The Rights Declaration wording RIGHTS_VERSION stands for; a change needs a new version on both sides.
const RIGHTS_VERSION = 'rights-2026-10-13';
const RIGHTS_TEXT = 'I own or hold the rights to everything in this title, including any real people, voices, music and footage, and I have declared its AI use truthfully.';
const disclosureLabels = (t) => ({ generated_video: t("cinema.creatorWorkspace.generatedVideo"), generated_voice: t("cinema.creatorWorkspace.generatedVoice"), generated_music: t("cinema.creatorWorkspace.generatedMusic"), synthetic_people: t("cinema.creatorWorkspace.syntheticPeople"), face_replacement: t("cinema.creatorWorkspace.faceReplacement"), cloned_voice: t("cinema.creatorWorkspace.clonedVoice"), generated_script: t("cinema.creatorWorkspace.generatedScript"), manipulated_real_world_footage: t("cinema.creatorWorkspace.manipulatedRealWorldFootage") });
const input = 'mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-vx-fg focus:outline-solid focus:outline-2 focus:outline-vx-accent';
export function CreatorWorkspace({proxyUploadsEnabled=false, analyticsEnabled=false}) {
  const { t } = useI18n();
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const preview = useCinemaPreview();
  if (!preview) return <p role="status" className="mt-8">{t("cinema.creatorWorkspace.theCreatorWorkspaceIsInPreview")}</p>;
  if (!account) return <div className="mt-8"><p className="mb-4">{t("cinema.creatorWorkspace.signInWithYourApprovedCinema")}</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</Button></div>;
  return <div key={account}><Drafts proxyUploadsEnabled={proxyUploadsEnabled} />{analyticsEnabled && <CreatorAnalytics />}</div>;
}
function Drafts({proxyUploadsEnabled}) {
  const { t, href: localize, locale } = useI18n();

  const [path, setPath] = useState([]), [items, setItems] = useState([]);
  const [state, setState] = useState('loading'), [error, setError] = useState('');
  const [version, setVersion] = useState(0), [editor, setEditor] = useState(null), [notice, setNotice] = useState('');
  const [video, setVideo] = useState(null), [publish, setPublish] = useState(null);
  async function withdraw(item) {
    if (!window.confirm(item.lifecycle_status === 'PUBLISHED' ? t("cinema.creatorWorkspace.withdrawThisTitleFromSocialCinema") : t("cinema.creatorWorkspace.withdrawThisSubmissionFromReview"))) return;
    const reason = window.prompt(t("cinema.creatorWorkspace.reasonKeptInTheAuditRecord"), t("cinema.creatorWorkspace.creatorWithdrawal"));
    if (!reason || reason.trim().length < 3) return;
    setNotice('');
    try { const r = await gatewayFetch('/cinema/content/withdraw', { method: 'POST', body: JSON.stringify({ content_id: item.id, reason: reason.trim() }), headers: { 'idempotency-key': crypto.randomUUID() } }); setNotice(r.unlocks_reversed > 0 ? t(pluralKey(t, locale, 'cinema.creator.refunded', r.unlocks_reversed), { count: r.unlocks_reversed }) : t("cinema.creatorWorkspace.withdrawnItIsAPrivateDraft")); setVersion(n => n + 1); }
    catch (e) { setNotice(message(e.code, t)); }
  }
  const parent = path.at(-1), parentId = parent?.id;
  useEffect(() => {
    let active = true;
    setState('loading'); setItems([]); setError('');
    gatewayFetch(`/cinema/content${parentId ? `?parent_id=${encodeURIComponent(parentId)}` : ''}`).then(data => {
      if (active) { setItems(data.content); setState('ready'); }
    }).catch(e => { if (active) { setError(message(e.code, t)); setState('error'); } });
    return () => { active = false; };
  }, [parentId, version, t]);
  function navigate(next) { setVideo(null); setEditor(null); setPublish(null); setNotice(''); setPath(next); }
  const types = parent ? [parent.content_type === 'SERIES' ? 'SEASON' : 'EPISODE'] : ['SERIES','FILM','SHORT','TRAILER'];
  return <section className="mt-10 border-t border-vx-border pt-6" aria-labelledby="drafts-title">
    <nav aria-label={t("cinema.creatorWorkspace.draftLocation")} className="flex flex-wrap gap-2 text-sm">
      <button type="button" onClick={() => navigate([])} className="rounded-sm px-2 py-2 text-vx-accent focus-visible:outline-vx-accent">{t("cinema.creatorWorkspace.allProjects")}</button>
      {path.map((item, i) => <button key={item.id} type="button" onClick={() => navigate(path.slice(0, i + 1))} className="max-w-full wrap-break-word rounded-sm px-2 py-2 text-vx-accent focus-visible:outline-vx-accent">/ {item.title}</button>)}
    </nav>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <h2 id="drafts-title" className="text-2xl font-bold">{parent ? t('cinema.creator.drafts', { type: tOr(t, `cinema.type.${types[0]}`, types[0]) }) : t("cinema.creatorWorkspace.yourProjects")}</h2>
      {state === 'ready' && !editor && !video && !publish && <Button onClick={() => { setNotice(''); setEditor({ content_type: types[0], parent_id: parentId || null, position: parent ? Math.max(0, ...items.map(i => i.position)) + 1 : null, title: '', synopsis: '', language: parent?.language || 'en', ai_disclosures: [] }); }}>{parent ? t('cinema.creator.newType', { type: tOr(t, `cinema.type.${types[0]}`, types[0]) }) : t('cinema.creator.newProject')}</Button>}
    </div>
    {notice && <p role="status" className="mt-4 text-vx-accent">{notice}</p>}
    {state === 'loading' ? <p role="status" className="mt-6">{t("cinema.creatorWorkspace.loadingYourDrafts")}</p> : state === 'error' ? <div className="mt-6"><p role="alert">{error}</p><Button variant="ghost" className="mt-4" onClick={() => setVersion(n => n + 1)}>{t("recovery.retry")}</Button></div> : <>
      {publish ? <SubmitForReview key={publish.id} item={publish} onClose={() => setPublish(null)} onDone={() => { setPublish(null); setNotice(t("cinema.creatorWorkspace.submittedForReviewYouWillSee")); setVersion(n => n + 1); }} /> : video ? <VideoUpload key={video.id} content={video} proxyUploadsEnabled={proxyUploadsEnabled} onClose={() => setVideo(null)} /> : editor ? <DraftEditor key={`${editor.id || 'new'}:${editor.revision || 0}`} draft={editor} types={types} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice(t("cinema.creatorWorkspace.draftSavedPrivately")); setVersion(n => n + 1); }} onReload={() => { setEditor(null); setVersion(n => n + 1); }} /> : items.length ? <ul className="mt-6 divide-y divide-vx-border border-y border-vx-border">
        {items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="min-w-0 flex-1"><p className="text-xs font-vx-mono text-vx-fg-muted">{tOr(t, `cinema.type.${item.content_type}`, item.content_type)}{item.position ? ` ${item.position}` : ''} · {stateLabels(t)[item.lifecycle_status] || t("cinema.creatorWorkspace.privateDraft")}{item.video_ready ? t("cinema.creatorWorkspace.videoReady") : ''}</p>{item.review_note && <p className="mt-2 text-sm text-vx-danger">{t("cinema.creatorWorkspace.reviewerNote")}{' '}{item.review_note}</p>}<h3 className="mt-2 wrap-break-word font-bold">{item.title}</h3><p className="mt-2 line-clamp-2 wrap-break-word text-sm text-vx-fg-body">{item.synopsis || t("cinema.creatorWorkspace.noSynopsisYet")}</p></div>
          <div className="flex flex-wrap gap-2">{item.lifecycle_status === 'DRAFT' && <Button variant="ghost" size="sm" onClick={() => { setNotice(''); setEditor(item); }} aria-label={t('cinema.creator.edit', { title: item.title })}>{t("label.Edit")}</Button>}{!parent && item.lifecycle_status === 'DRAFT' && <Button variant="ghost" size="sm" onClick={() => { setNotice(''); setPublish(item); }}>{t("cinema.comments.submitForReview")}</Button>}{!parent && ['UNDER_REVIEW', 'PUBLISHED'].includes(item.lifecycle_status) && <Button variant="ghost" size="sm" onClick={() => withdraw(item)}>{item.lifecycle_status === 'PUBLISHED' ? t("cinema.creatorWorkspace.withdrawFromCinema") : t("cinema.creatorWorkspace.withdrawSubmission")}</Button>}{!parent && item.lifecycle_status === 'PUBLISHED' && <a href={localize(`/social-cinema/title/${item.id}`)} className="rounded-full px-3 py-2 text-sm font-bold text-vx-accent">{t("cinema.creatorWorkspace.viewPublicPage")}</a>}{['FILM','SHORT','TRAILER','EPISODE'].includes(item.content_type) && <Button variant="ghost" size="sm" onClick={() => { setNotice(''); setVideo(item); }}>{t("cinema.creatorWorkspace.videoUpload")}</Button>}{['SERIES','SEASON'].includes(item.content_type) && <Button variant="ghost" size="sm" onClick={() => navigate([...path, item])}>{t(item.content_type === 'SERIES' ? 'cinema.creator.openSeasons' : 'cinema.creator.openEpisodes')}</Button>}</div>
        </li>)}
      </ul> : <div className="py-10"><h3 className="font-bold">{parent ? t('cinema.creator.first', { type: tOr(t, `cinema.type.${types[0]}`, types[0]) }) : t("cinema.creatorWorkspace.startWithAStory")}</h3><p className="mt-3 text-vx-fg-muted">{parent ? t("cinema.creatorWorkspace.giveItATitleAndSynopsis") : t("cinema.creatorWorkspace.createASeriesWithSeasonsAnd")}</p></div>}
    </>}
  </section>;
}
function DraftEditor({ draft, types, onCancel, onSaved, onReload }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef(null);
  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ ...(draft.id ? { id: draft.id, revision: draft.revision } : {}),
      content_type: draft.id ? draft.content_type : form.get('content_type'), parent_id: draft.parent_id,
      position: draft.parent_id ? (draft.id ? draft.position : Number(form.get('position'))) : null,
      title: form.get('title').trim(), synopsis: form.get('synopsis'), language: form.get('language').trim(), ai_disclosures: form.getAll('ai_disclosures'),
      ...(draft.parent_id ? {} : { categories: form.getAll('categories').slice(0, MAX_CATEGORIES) }) });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await gatewayFetch('/cinema/content', { method: draft.id ? 'PATCH' : 'POST', body, headers: { 'idempotency-key': attempt.current.key } }); onSaved(); }
    catch(e) { setError(e.code || 'temporarily_unavailable'); setBusy(false); }
  }
  return <form onSubmit={save} className="mt-6 max-w-2xl space-y-5">
    <fieldset disabled={busy} className="space-y-5">
      <legend className="mb-4 font-bold">{draft.id ? t('cinema.creator.edit', { title: tOr(t, `cinema.type.${draft.content_type}`, draft.content_type) }) : t("cinema.creatorWorkspace.newDraft")}</legend>
      {!draft.id && <label className="block text-sm font-semibold" htmlFor="draft-type">{t("cinema.creatorWorkspace.type")}<select id="draft-type" name="content_type" defaultValue={draft.content_type} className={input}>{types.map(type => <option key={type} value={type}>{tOr(t, `cinema.type.${type}`, type)}</option>)}</select></label>}
      {draft.parent_id && !draft.id && <label className="block text-sm font-semibold" htmlFor="draft-position">{t('cinema.creator.number', { type: tOr(t, `cinema.type.${draft.content_type}`, draft.content_type) })}<input id="draft-position" name="position" type="number" min={1} max={10000} step={1} required defaultValue={draft.position} className={input} /></label>}
      <label className="block text-sm font-semibold" htmlFor="draft-title">{t("cinema.creatorWorkspace.title")}<input id="draft-title" name="title" required maxLength={160} defaultValue={draft.title} className={input} /></label>
      <label className="block text-sm font-semibold" htmlFor="draft-synopsis">{t("cinema.creatorWorkspace.synopsis")}<textarea id="draft-synopsis" name="synopsis" rows={5} maxLength={2000} defaultValue={draft.synopsis} className={input} /></label>
      <label className="block text-sm font-semibold" htmlFor="draft-language">{t("cinema.creatorWorkspace.languageCode")}<input id="draft-language" name="language" required pattern="[a-z]{2,3}(-[A-Z]{2})?" maxLength={6} defaultValue={draft.language} className={input} aria-describedby="language-help" /></label>
      <p id="language-help" className="text-xs text-vx-fg-muted">{t("cinema.creatorWorkspace.forExampleEnEnglishFrFrench")}</p>
      {!draft.parent_id && <fieldset><legend className="font-semibold">{t("cinema.creatorWorkspace.categories")}</legend><p className="mt-2 text-sm text-vx-fg-muted">{t("cinema.creatorWorkspace.pickOneOrTwoViewersBrowse")}</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{CINEMA_CATEGORIES.map(([slug, label]) => <label key={slug} className="flex items-start gap-3 text-sm"><input type="checkbox" name="categories" value={slug} defaultChecked={(draft.categories || []).includes(slug)} className="mt-1 accent-vx-accent" />{tOr(t, `cinema.category.${slug}`, label || slug)}</label>)}</div></fieldset>}
      <fieldset><legend className="font-semibold">{t("cinema.creatorWorkspace.aiDisclosures")}</legend><p className="mt-2 text-sm text-vx-fg-muted">{t("cinema.creatorWorkspace.selectWhatYouPlanToUse")}</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{AI_DISCLOSURES.map(value => <label key={value} className="flex items-start gap-3 text-sm"><input type="checkbox" name="ai_disclosures" value={value} defaultChecked={draft.ai_disclosures.includes(value)} className="mt-1 accent-vx-accent" />{disclosureLabels(t)[value]}</label>)}</div></fieldset>
    </fieldset>
    {error && <div role="alert"><p>{message(error, t)}</p>{error === 'revision_conflict' && <Button variant="ghost" className="mt-3" type="button" onClick={onReload}>{t("cinema.creatorWorkspace.discardTheseEditsAndReload")}</Button>}</div>}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy ? t("social.saving") : t("cinema.creatorWorkspace.savePrivateDraft")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{t("cinema.creatorWorkspace.cancel")}</Button></div>
  </form>;
}
function message(code, t) {
  return ({ publishing_not_open: t("cinema.creatorWorkspace.publishingIsNotOpenYet"), category_required: t("cinema.creatorWorkspace.pickAtLeastOneCategoryFor"), invalid_category: t("cinema.creatorWorkspace.chooseUpToTwoCategoriesFrom"), not_withdrawable: t("cinema.creatorWorkspace.thisTitleCannotBeWithdrawnIn"), already_submitted: t("cinema.creatorWorkspace.thisTitleIsAlreadyUnderReview"), already_published: t("cinema.creatorWorkspace.thisTitleIsAlreadyPublished"), suspended: t("cinema.creatorWorkspace.thisTitleWasSuspendedByAn"), content_not_open: t("cinema.creatorWorkspace.draftCreationIsNotOpenYet"), creator_required: t("cinema.creatorWorkspace.anApprovedCinemaCreatorAccountIs"), account_not_active: t("cinema.creatorWorkspace.yourCinemaAccountCannotManageDrafts"), revision_conflict: t("cinema.creatorWorkspace.thisDraftChangedInAnotherSession"), position_taken: t("cinema.creatorWorkspace.thatNumberIsAlreadyInUse"), draft_limit_reached: t("cinema.creatorWorkspace.youHaveReachedThePreviewDraft"), invalid_draft: t("cinema.creatorWorkspace.checkTheTitleLanguageAndOther"), rate_limited: t("cinema.creatorApplication.tooManyRequestsWaitAMinute"), content_not_found: t("cinema.creatorWorkspace.thatDraftIsNoLongerAvailable"), idempotency_conflict: t("cinema.creatorWorkspace.thisSaveAttemptChangedReloadYour") })[code] || t("cinema.creatorWorkspace.weCouldNotLoadOrSave");
}
function SubmitForReview({ item, onClose, onDone }) {
  const { t } = useI18n();

  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ content_id: item.id, rights_version: RIGHTS_VERSION, policy_version: CINEMA_POLICY_VERSION,
      audience_rating: form.get('audience_rating'), content_warnings: form.getAll('content_warnings'),
      safety_confirmed: form.get('safety_confirmed') === 'yes', malware_confirmed: form.get('malware_confirmed') === 'yes' });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await gatewayFetch('/cinema/content/submit', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } }); onDone(); }
    catch (e) { setError(e.code === 'video_not_ready' ? t("cinema.creatorWorkspace.everyEpisodeOrTheFilmItself") : e.code === 'no_episodes' ? t("cinema.creatorWorkspace.addAtLeastOneEpisodeTo") : ['rights_version_required', 'policy_version_required'].includes(e.code) ? t("cinema.creatorWorkspace.theDeclarationChangedReloadAndRead") : message(e.code, t)); setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-6 max-w-2xl space-y-5">
    <h3 className="text-xl font-bold">{t('cinema.creator.submitTitle', { title: item.title })}</h3>
    <p className="text-sm text-vx-fg-body">{t('cinema.creator.reviewPolicy', { type: tOr(t, `cinema.type.${item.content_type}`, item.content_type) })}</p>
    <label className="block text-sm font-semibold" htmlFor="cinema-audience-rating">{t("cinema.creatorWorkspace.audienceRating")}<select id="cinema-audience-rating" name="audience_rating" required defaultValue="" className={input}>
        <option value="" disabled>{t("cinema.creatorWorkspace.chooseARating")}</option>{CINEMA_RATINGS.map(([code, label]) => <option key={code} value={code}>{tOr(t, `cinema.rating.${code}`, label || code)}</option>)}
      </select>
    </label>
    <p className="text-xs text-vx-fg-muted">{t("cinema.creatorWorkspace.veyrnoxGuidanceOnlyTheseAreNot")}</p>
    <fieldset><legend className="font-semibold">{t("cinema.creatorWorkspace.contentWarnings")}</legend><p className="mt-2 text-sm text-vx-fg-muted">{t("cinema.creatorWorkspace.selectEveryWarningThatAppliesLeave")}</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{CINEMA_WARNING_CODES.map(([code, label]) => <label key={code} className="flex items-start gap-3 text-sm"><input type="checkbox" name="content_warnings" value={code} className="mt-1 accent-vx-accent" />{tOr(t, `cinema.warning.${code}`, label || code)}</label>)}</div></fieldset>
    <div className="space-y-3 rounded-xl border border-vx-border p-4">
      <BindingText id="creatorRights"  ><label className="flex items-start gap-3 text-sm text-vx-fg-body"><input type="checkbox" name="rights_confirmed" value="yes" className="mt-1 accent-vx-accent" required /><span lang="en" dir="ltr">{RIGHTS_TEXT}</span></label></BindingText>
      <BindingText id="creatorSafety"  slots={{ policy: <BindingPolicyLink policy="cinema-content" /> }}><label className="flex items-start gap-3 text-sm text-vx-fg-body"><input type="checkbox" name="safety_confirmed" value="yes" className="mt-1 accent-vx-accent" required /><span lang="en" dir="ltr">This title contains no nudity, pornography, explicit sexual content, sexualised minors, non-consensual intimate imagery, sexual violence, or sexual deepfake of a real person. I have read the <a href="/legal/cinema-content" target="_blank" rel="noreferrer" className="font-semibold underline">Cinema Content Policy</a>.</span></label></BindingText>
      <BindingText id="creatorMalware"  ><label className="flex items-start gap-3 text-sm text-vx-fg-body"><input type="checkbox" name="malware_confirmed" value="yes" className="mt-1 accent-vx-accent" required /><span lang="en" dir="ltr">I have not intentionally included malware, executable code, disguised files or links intended to compromise viewers or Veyrnox.</span></label></BindingText>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy ? t("cinema.creatorApplication.submitting") : t("cinema.comments.submitForReview")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("cinema.creatorWorkspace.cancel")}</Button></div>
  </form>;
}
