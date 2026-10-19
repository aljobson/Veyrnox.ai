'use client';
import { tOr, pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Modal } from '../../../_components/Modal';
import NetworkLogo from '../NetworkLogo';
import BrandSwitcher from '../BrandSwitcher';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts, NETWORKS } from '../../../../lib/socialConnectClient';
import { cancelSocialPost, listSocialCalendar, rescheduleSocialPost, restoreSocialPost } from '../../../../lib/socialPostsClient';
import { calendarWindow, shiftCalendar, dateKey, droppedSchedule, localInput, localSchedule, POST_STATUSES } from '../../../../../lib/social/calendar.js';

const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input='rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const noAccount=()=>'';
const currentAccount=()=>getSession()?.user?.id||'';
const today=()=>dateKey(new Date());
const noSubscription=()=>()=>{};
const dayLabel=(day,locale)=>new Date(`${day}T12:00:00`).toLocaleDateString(localeTag(locale),{weekday:'short',day:'numeric',month:'short'});
const timeLabel=(at,locale)=>new Date(at).toLocaleTimeString(localeTag(locale),{hour:'2-digit',minute:'2-digit'});
// View ids come only from this closed list; translated labels never become state.
const CALENDAR_VIEWS = [{ id: 'month', key: 'cinema.pass.month' }, { id: 'week', key: 'cinema.pass.week' }, { id: 'list', key: 'app.library.view.list' }];
const networkLabel=(key)=>NETWORKS.find(n=>n.key===key)?.label||key;
const weekdayLabel=(index,locale)=>locale==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]:new Date(Date.UTC(2026,9,19+index)).toLocaleDateString(localeTag(locale),{weekday:'short',timeZone:'UTC'});
const restoreDefault=(post)=>localInput(new Date(Math.max(Date.parse(post.scheduled_at)||0,Date.now()+60*60*1000)));

export default function Calendar() {
  const { t } = useI18n();
    const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
    const date=useSyncExternalStore(noSubscription,today,noAccount);
    return <><AppNav/><Main className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
        <Link href="/app/publish" className="text-sm text-vx-accent underline">Veyrnox.ai Publish</Link>
        <h1 data-testid="publish-calendar-title" className="text-3xl font-black mt-3 mb-2">{t("label.Publishing calendar")}</h1>
        <p className="text-sm text-vx-fg-muted mb-4">{t("app.publish.calendar.intro")}</p>
        {account && <BrandSwitcher />}
        {account&&date?<CalendarControls key={account} today={date}/>:<p className="text-sm">{t("app.publish.calendar.signIn")}{' '}<button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button></p>}
    </Main></>;
}

function CalendarControls({today}) {
  const { t, locale } = useI18n();
    const [planTier,setPlanTier]=useState(null);
    const [brandRole,setBrandRole]=useState('owner');
    const [anchor,setAnchor]=useState(today),[view,setView]=useState('month');
    const [status,setStatus]=useState(''),[network,setNetwork]=useState('');
    const [refresh,setRefresh]=useState(0),[result,setResult]=useState(null),[loadError,setLoadError]=useState('');
    const [moreLoading,setMoreLoading]=useState(false),[edit,setEdit]=useState(null),[cancelPost,setCancelPost]=useState(null),[message,setMessage]=useState('');
    const requestId=useRef(0);
    useEffect(()=>{let active=true;listSocialAccounts().then((accountResult)=>{if(active){setPlanTier(accountResult.planTier||'free');setBrandRole(accountResult.brandRole||'owner');}}).catch(()=>{if(active)setPlanTier('free');});return()=>{active=false;};},[]);
    const range=calendarWindow(anchor,view);
    const queryKey=JSON.stringify([range.from,range.to,status,network,refresh]);
    useEffect(()=>{
        if(planTier!=='publish')return;
        const id=++requestId.current;
        let active=true;
        const timeout=window.setTimeout(()=>{
            if(active&&id===requestId.current){
                setResult({posts:[],next:null,key:queryKey});
                setLoadError(t("app.publish.calendar.timeout"));
            }
        },8000);
        listSocialCalendar({from:range.from,to:range.to,status,network}).then(data=>{
            window.clearTimeout(timeout);
            if(active&&id===requestId.current){setResult({...data,key:queryKey});setLoadError('');}
        }).catch(()=>{window.clearTimeout(timeout);if(active&&id===requestId.current){setResult({posts:[],next:null,key:queryKey});setLoadError(t("app.publish.calendar.loadFailed"));}});
        return()=>{active=false;window.clearTimeout(timeout);};
    },[queryKey,range.from,range.to,status,network,planTier,t]);
    if(planTier===null)return <p className="text-sm text-vx-fg-muted">{t("app.publish.analytics.loadingPlan")}</p>;
    if(planTier!=='publish')return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6"><p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{t("publish.plan.colPlan")}</p><h2 className="mt-2 text-2xl font-black">{t("app.publish.calendar.unlock")}</h2><p className="mt-3 text-sm text-vx-fg-body">{t("app.publish.calendar.planIncludes")}</p><Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">{t("app.publish.smartlink.viewPlan")}</Link></section>;
    const loading=result?.key!==queryKey;
    const posts=loading?[]:result.posts;
    const currentDay=dateKey(new Date());
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const title=view==='week'?`${dayLabel(range.days[0],locale)} – ${dayLabel(range.days[6],locale)}`
        :new Date(`${anchor}T12:00:00`).toLocaleDateString(localeTag(locale),{month:'long',year:'numeric'});
    async function more(){
        const id=requestId.current;setMoreLoading(true);
        try{
            const data=await listSocialCalendar({from:range.from,to:range.to,status,network,afterAt:result.next.at,afterId:result.next.id});
            if(id===requestId.current)setResult(previous=>({...data,key:queryKey,posts:[...previous.posts,...data.posts]}));
        }catch{if(id===requestId.current)setLoadError(t("app.publish.calendar.moreFailed"));}
        finally{setMoreLoading(false);}
    }
    function drop(event,day){
        event.preventDefault();
        const post=posts.find(p=>p.id===event.dataTransfer.getData('application/x-veyrnox-post'));
        if(['owner','manager','editor'].includes(brandRole)&&post?.can_reschedule)setEdit({mode:'reschedule',post,value:droppedSchedule(post,day)});
    }
    const groups=new Map(range.days.map(day=>[day,posts.filter(p=>dateKey(p.scheduled_at)===day)]));
    return <div className="space-y-5">
        <div className="flex flex-wrap gap-2" role="group" data-assistant-target="publish.calendar" aria-label={t("app.publish.calendar.view")}>
            {CALENDAR_VIEWS.map(option=><button key={option.id} type="button" className={`${button} capitalize ${view===option.id?'bg-vx-accent text-black':''}`} aria-pressed={view===option.id} onClick={()=>setView(option.id)}>{t(option.key)}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={button} onClick={()=>setAnchor(shiftCalendar(anchor,view,-1))} aria-label={t(view === 'week' ? 'app.publish.calendar.previousWeek' : 'app.publish.calendar.previousMonth')}>{t('app.publish.calendar.previous')}</button>
            <button type="button" data-testid="publish-calendar-today" className={button} onClick={()=>setAnchor(dateKey(new Date()))}>{t("app.publish.calendar.today")}</button>
            <button type="button" className={button} onClick={()=>setAnchor(shiftCalendar(anchor,view,1))} aria-label={t(view === 'week' ? 'app.publish.calendar.nextWeek' : 'app.publish.calendar.nextMonth')}>{t('app.publish.calendar.next')}</button>
            <h2 className="font-bold" aria-live="polite">{title}</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-bold">{t("app.publish.developer.status")}<select data-testid="publish-calendar-status" className={`${input} block mt-1`} value={status} onChange={e=>setStatus(e.target.value)}><option value="">{t("app.publish.calendar.allStatuses")}</option>{POST_STATUSES.map(s=><option key={s} value={s}>{tOr(t, `app.publish.composer.status.${s}`, s)}</option>)}</select></label>
            <label className="text-sm font-bold">{t("app.publish.calendar.network")}<select className={`${input} block mt-1`} value={network} onChange={e=>setNetwork(e.target.value)}><option value="">{t("app.publish.calendar.allNetworks")}</option>{NETWORKS.map(n=><option key={n.key} value={n.key}>{tOr(t, `app.publish.network.${n.key}`, n.label)}</option>)}</select></label>
            <button type="button" className={button} onClick={()=>setRefresh(n=>n+1)}>{t("app.publish.developer.refresh")}</button>
        </div>
        <p className="text-xs text-vx-fg-muted">{t('app.publish.calendar.timezoneHelp',{timezone})}</p>
        {message&&<p role="status" className="text-sm text-vx-accent">{message}</p>}
        {loading?<p role="status" className="text-sm text-vx-fg-muted">{t("app.publish.calendar.loading")}</p>:<>
            {loadError&&<p role="alert" className="text-sm text-vx-danger">{loadError}</p>}
            {!loadError&&posts.length===0&&<p className="text-sm text-vx-fg-muted">{t("app.publish.calendar.empty")}</p>}
            {view==='list'?<div className="space-y-4">{range.days.filter(day=>groups.get(day).length).map(day=><section key={day} aria-label={dayLabel(day,locale)}>
                <h3 className="font-bold mb-2">{dayLabel(day,locale)}</h3><ul className="space-y-2">{groups.get(day).map(post=><li key={post.id}><PostCard post={post} canWrite={['owner','manager','editor'].includes(brandRole)} onEdit={()=>setEdit({mode:'reschedule',post,value:localInput(post.scheduled_at)})} onCancel={()=>setCancelPost(post)} onRestore={()=>setEdit({mode:'restore',post,value:restoreDefault(post)})}/></li>)}</ul>
            </section>)}</div>:<div className="relative overflow-x-auto rounded-xl border border-vx-border focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" tabIndex={0} role="region" aria-label={t('app.publish.calendar.scroll',{view:locale==='en'?view:t(CALENDAR_VIEWS.find(option=>option.id===view).key)})}>
                <table className="w-full min-w-[840px] table-fixed text-sm">
                    <caption className="sr-only">{t('app.publish.calendar.caption',{title})}</caption>
                    <thead><tr>{Array.from({length:7},(_,index)=>index).map(day=><th scope="col" key={day} className="p-3 text-start text-vx-fg-muted">{weekdayLabel(day,locale)}</th>)}</tr></thead>
                    <tbody>{Array.from({length:range.days.length/7},(_,week)=><tr key={week}>{range.days.slice(week*7,week*7+7).map(day=><td key={day} className={`align-top border-t border-e border-vx-border p-2 ${day===currentDay?'bg-vx-accent/10':''}`}
                        onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-veyrnox-post'))e.preventDefault();}} onDrop={e=>drop(e,day)} data-calendar-day={day}>
                        <div className="min-h-28"><h3 className="text-xs font-bold mb-2">{dayLabel(day,locale)}{day===currentDay&&<span className="sr-only">{t("app.publish.calendar.todaySuffix")}</span>}</h3>
                        <ul className="space-y-2">{groups.get(day).map(post=><li key={post.id}><PostCard post={post} canWrite={['owner','manager','editor'].includes(brandRole)} onEdit={()=>setEdit({mode:'reschedule',post,value:localInput(post.scheduled_at)})} onCancel={()=>setCancelPost(post)} onRestore={()=>setEdit({mode:'restore',post,value:restoreDefault(post)})}/></li>)}</ul></div>
                    </td>)}</tr>)}</tbody>
                </table>
            </div>}
            {result.next&&<div className="text-sm"><p className="text-vx-fg-muted mb-2">{t(pluralKey(t,locale,'app.publish.calendar.showing',posts.length),{count:locale==='en'?posts.length:posts.length.toLocaleString(localeTag(locale))})}</p><button type="button" className={button} disabled={moreLoading} onClick={more}>{moreLoading?t("cinema.titlePage.loading"):t("app.publish.calendar.loadMore")}</button></div>}
        </>}
        {edit&&<ScheduleDialog key={`${edit.mode}:${edit.post.id}:${edit.value}`} {...edit} timezone={timezone} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);setMessage(edit.mode==='restore'?t("app.publish.calendar.restored"):t("app.publish.calendar.rescheduled"));setRefresh(n=>n+1);}}/>}
        {cancelPost&&<CancelDialog post={cancelPost} onClose={()=>setCancelPost(null)} onSaved={()=>{setCancelPost(null);setMessage(t("app.publish.calendar.canceled"));setRefresh(n=>n+1);}}/>}
    </div>;
}

function PostCard({post,canWrite,onEdit,onCancel,onRestore}) {
  const { t, locale } = useI18n();
    return <article className="rounded-lg border border-vx-border bg-vx-panel p-2 space-y-2 wrap-break-word" draggable={canWrite&&post.can_reschedule===true}
        onDragStart={e=>{if(!canWrite||!post.can_reschedule){e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-veyrnox-post',post.id);}} data-calendar-post={post.id}>
        <p className="text-xs font-bold"><time dateTime={post.scheduled_at}>{timeLabel(post.scheduled_at,locale)}</time> · {tOr(t, `app.publish.composer.status.${post.status}`, post.status)}</p>
        <p className="text-sm line-clamp-3">{post.global_text||t("app.publish.calendar.mediaPost")}</p>
        <ul className="text-xs text-vx-fg-muted space-y-1">{(post.targets||[]).map(target=><li key={target.id} className="flex flex-wrap items-center gap-1"><NetworkLogo network={target.network} className="h-3.5 w-3.5" />{tOr(t, `app.publish.network.${target.network}`, networkLabel(target.network))}: {target.publish_status==='delivered'?t('app.publish.calendar.delivered'):target.publish_status==='submitted'?t("app.publish.composer.status.submitted"):tOr(t, `app.publish.composer.status.${target.publish_status}`, target.publish_status)}
            {target.publish_status==='published'&&/^https:\/\//.test(target.platform_post_url||'')&&<> · <a href={target.platform_post_url} target="_blank" rel="noreferrer" className="underline">{t("app.publish.calendar.viewPost")}</a></>}
        </li>)}</ul>
        {canWrite&&post.can_reschedule?<div className="flex flex-wrap gap-3"><button type="button" className="text-xs font-bold text-vx-accent underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" onClick={onEdit}>{t("app.publish.calendar.reschedule")}<span className="sr-only"> {post.global_text||t("app.publish.calendar.mediaPostLower")}</span></button><button type="button" className="text-xs font-bold text-vx-danger underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" onClick={onCancel}>{t("app.publish.calendar.cancelPost")}<span className="sr-only"> {post.global_text||t("app.publish.calendar.mediaPostLower")}</span></button></div>
            :canWrite&&post.can_restore?<button type="button" className="text-xs font-bold text-vx-accent underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" onClick={onRestore}>{t("app.publish.calendar.restorePost")}<span className="sr-only"> {post.global_text||t("app.publish.calendar.mediaPostLower")}</span></button>
                :<p className="text-xs text-vx-fg-muted">{canWrite?t("app.publish.calendar.locked"):t("app.publish.calendar.readOnly")}</p>}
    </article>;
}

function ScheduleDialog({mode,post,value,timezone,onClose,onSaved}) {
  const { t, locale } = useI18n();
    const [when,setWhen]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const inputRef=useRef(null);
    const proposed=localSchedule(when);
    async function save(e){
        e.preventDefault();setError('');
        const iso=localSchedule(when);
        if(!iso||Date.parse(iso)<=Date.now()+60000){setError(t("app.publish.calendar.invalidTime"));return;}
        setBusy(true);
        try{if(mode==='restore')await restoreSocialPost(post.id,post.updated_at,iso);else await rescheduleSocialPost(post.id,post.scheduled_at,iso);onSaved();}
        catch(err){setError(['POST_STARTED','SCHEDULE_CHANGED','POST_CHANGED','POST_BUSY','RESTORE_UNAVAILABLE'].includes(err?.code)?t("app.publish.calendar.changedForm")
            :err?.code==='rate_limited'?t("app.publish.calendar.tooManyChanges"):t(mode==='restore'?'app.publish.calendar.restoreFailed':'app.publish.calendar.rescheduleFailed'));}
        finally{setBusy(false);}
    }
    const restoring=mode==='restore';
    return <Modal onCancel={()=>{if(!busy)onClose();}} initialFocusRef={inputRef} className="items-center justify-center p-4" aria-labelledby="schedule-title">
        <form onSubmit={save} className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-base p-5 space-y-4">
            <h2 id="schedule-title" className="font-bold text-lg">{restoring?t("app.publish.calendar.restorePost"):t("app.publish.calendar.reschedulePost")}</h2>
            <p className="text-sm wrap-break-word line-clamp-3">{post.global_text||t("app.publish.calendar.mediaPost")}</p>
            <p className="text-xs text-vx-fg-muted">{restoring?t("app.publish.calendar.canceledSchedule"):t("app.publish.calendar.current")}: {new Date(post.scheduled_at).toLocaleString(localeTag(locale))} · {timezone}{t("app.publish.calendar.targetsMove")}</p>
            <label className="block text-sm font-bold">{t("app.publish.calendar.newDate")}<input ref={inputRef} type="datetime-local" required className={`${input} mt-2 block w-full`} value={when} disabled={busy} onChange={e=>setWhen(e.target.value)}/></label>
            {proposed&&<p className="text-xs text-vx-fg-muted">{t('app.publish.calendar.utcTime',{time:proposed})}</p>}
            {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
            <div className="flex flex-wrap gap-3"><button type="submit" className={`${button} bg-vx-accent text-black`} disabled={busy}>{busy?t("social.saving"):restoring?t("app.publish.calendar.restorePost"):t("app.publish.calendar.confirmTime")}</button><button type="button" className={button} disabled={busy} onClick={onClose}>{t("authGate.close")}</button></div>
        </form>
    </Modal>;
}

function CancelDialog({post,onClose,onSaved}) {
  const { t } = useI18n();
    const [busy,setBusy]=useState(false),[error,setError]=useState('');
    const confirmRef=useRef(null);
    async function cancel(){setBusy(true);setError('');try{await cancelSocialPost(post.id,post.updated_at);onSaved();}
        catch(err){setError(['POST_STARTED','POST_CHANGED','POST_BUSY'].includes(err?.code)?t("app.publish.calendar.changedDialog")
            :err?.code==='rate_limited'?t("app.publish.calendar.tooManyChanges"):t("app.publish.calendar.cancelFailed"));}finally{setBusy(false);}}
    return <Modal onCancel={()=>{if(!busy)onClose();}} initialFocusRef={confirmRef} className="items-center justify-center p-4" aria-labelledby="cancel-post-title">
        <section className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-base p-5 space-y-4">
            <h2 id="cancel-post-title" className="font-bold text-lg">{t("app.publish.calendar.cancelQuestion")}</h2>
            <p className="text-sm wrap-break-word line-clamp-3">{post.global_text||t("app.publish.calendar.mediaPost")}</p>
            <p className="text-xs text-vx-fg-muted">{t("app.publish.calendar.cancelHelp")}</p>
            {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
            <div className="flex flex-wrap gap-3"><button ref={confirmRef} type="button" className={`${button} border-vx-danger text-vx-danger`} disabled={busy} onClick={cancel}>{busy?t("app.publish.calendar.canceling"):t("app.publish.calendar.cancelPost")}</button><button type="button" className={button} disabled={busy} onClick={onClose}>{t("app.publish.calendar.keepScheduled")}</button></div>
        </section>
    </Modal>;
}
