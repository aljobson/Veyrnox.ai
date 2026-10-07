'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Modal } from '../../../_components/Modal';
import NetworkLogo from '../NetworkLogo';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { NETWORKS } from '../../../../lib/socialConnectClient';
import { listSocialCalendar, rescheduleSocialPost } from '../../../../lib/socialPostsClient';
import { calendarWindow, shiftCalendar, dateKey, droppedSchedule, localInput, localSchedule, POST_STATUSES } from '../../../../../lib/social/calendar.js';

const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
const input='rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const noAccount=()=>'';
const currentAccount=()=>getSession()?.user?.id||'';
const today=()=>dateKey(new Date());
const noSubscription=()=>()=>{};
const dayLabel=(day)=>new Date(`${day}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
const timeLabel=(at)=>new Date(at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
const networkLabel=(key)=>NETWORKS.find(n=>n.key===key)?.label||key;

export default function Calendar() {
    const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
    const date=useSyncExternalStore(noSubscription,today,noAccount);
    return <><AppNav/><div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-10">
        <Link href="/app/publish" className="text-sm text-vx-accent underline">Veyrnox Publish</Link>
        <h1 className="text-3xl font-black mt-3 mb-2">Publishing calendar</h1>
        <p className="text-sm text-vx-fg-muted mb-6">Scheduled and completed posts. Drafts appear here once approved.</p>
        {account&&date?<CalendarControls key={account} today={date}/>:<p className="text-sm">Sign in to view your calendar. <button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button></p>}
    </div></>;
}

function CalendarControls({today}) {
    const [anchor,setAnchor]=useState(today),[view,setView]=useState('month');
    const [status,setStatus]=useState(''),[network,setNetwork]=useState('');
    const [refresh,setRefresh]=useState(0),[result,setResult]=useState(null),[loadError,setLoadError]=useState('');
    const [moreLoading,setMoreLoading]=useState(false),[edit,setEdit]=useState(null),[message,setMessage]=useState('');
    const requestId=useRef(0);
    const range=calendarWindow(anchor,view);
    const queryKey=JSON.stringify([range.from,range.to,status,network,refresh]);
    useEffect(()=>{
        const id=++requestId.current;
        let active=true;
        listSocialCalendar({from:range.from,to:range.to,status,network}).then(data=>{
            if(active&&id===requestId.current){setResult({...data,key:queryKey});setLoadError('');}
        }).catch(()=>{if(active&&id===requestId.current){setResult({posts:[],next:null,key:queryKey});setLoadError('Could not load your calendar. Try again.');}});
        return()=>{active=false;};
    },[queryKey,range.from,range.to,status,network]);
    const loading=result?.key!==queryKey;
    const posts=loading?[]:result.posts;
    const currentDay=dateKey(new Date());
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const title=view==='week'?`${dayLabel(range.days[0])} – ${dayLabel(range.days[6])}`
        :new Date(`${anchor}T12:00:00`).toLocaleDateString(undefined,{month:'long',year:'numeric'});
    async function more(){
        const id=requestId.current;setMoreLoading(true);
        try{
            const data=await listSocialCalendar({from:range.from,to:range.to,status,network,afterAt:result.next.at,afterId:result.next.id});
            if(id===requestId.current)setResult(previous=>({...data,key:queryKey,posts:[...previous.posts,...data.posts]}));
        }catch{if(id===requestId.current)setLoadError('Could not load more posts. Try again.');}
        finally{setMoreLoading(false);}
    }
    function drop(event,day){
        event.preventDefault();
        const post=posts.find(p=>p.id===event.dataTransfer.getData('application/x-veyrnox-post'));
        if(post?.can_reschedule)setEdit({post,value:droppedSchedule(post,day)});
    }
    const groups=new Map(range.days.map(day=>[day,posts.filter(p=>dateKey(p.scheduled_at)===day)]));
    return <div className="space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Calendar view">
            {['month','week','list'].map(v=><button key={v} type="button" className={`${button} capitalize ${view===v?'bg-vx-accent text-black':''}`} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={button} onClick={()=>setAnchor(shiftCalendar(anchor,view,-1))} aria-label={`Previous ${view==='week'?'week':'month'}`}>Previous</button>
            <button type="button" className={button} onClick={()=>setAnchor(dateKey(new Date()))}>Today</button>
            <button type="button" className={button} onClick={()=>setAnchor(shiftCalendar(anchor,view,1))} aria-label={`Next ${view==='week'?'week':'month'}`}>Next</button>
            <h2 className="font-bold" aria-live="polite">{title}</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-bold">Status<select className={`${input} block mt-1`} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{POST_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
            <label className="text-sm font-bold">Network<select className={`${input} block mt-1`} value={network} onChange={e=>setNetwork(e.target.value)}><option value="">All networks</option>{NETWORKS.map(n=><option key={n.key} value={n.key}>{n.label}</option>)}</select></label>
            <button type="button" className={button} onClick={()=>setRefresh(n=>n+1)}>Refresh</button>
        </div>
        <p className="text-xs text-vx-fg-muted">Times in your browser timezone: {timezone}. Drag an unstarted post to another day to review a new time, or use Reschedule. Changing a date never publishes immediately. On small screens, scroll the calendar or use List.</p>
        {message&&<p role="status" className="text-sm text-vx-accent">{message}</p>}
        {loading?<p role="status" className="text-sm text-vx-fg-muted">Loading calendar…</p>:<>
            {loadError&&<p role="alert" className="text-sm text-vx-danger">{loadError}</p>}
            {!loadError&&posts.length===0&&<p className="text-sm text-vx-fg-muted">No posts in this period match your filters.</p>}
            {view==='list'?<div className="space-y-4">{range.days.filter(day=>groups.get(day).length).map(day=><section key={day} aria-label={dayLabel(day)}>
                <h3 className="font-bold mb-2">{dayLabel(day)}</h3><ul className="space-y-2">{groups.get(day).map(post=><li key={post.id}><PostCard post={post} onEdit={()=>setEdit({post,value:localInput(post.scheduled_at)})}/></li>)}</ul>
            </section>)}</div>:<div className="relative overflow-x-auto rounded-xl border border-vx-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" tabIndex={0} role="region" aria-label={`${view} calendar, scroll horizontally on smaller screens`}>
                <table className="w-full min-w-[840px] table-fixed text-sm">
                    <caption className="sr-only">{title}. Scheduled posts by local date.</caption>
                    <thead><tr>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><th scope="col" key={day} className="p-3 text-left text-vx-fg-muted">{day}</th>)}</tr></thead>
                    <tbody>{Array.from({length:range.days.length/7},(_,week)=><tr key={week}>{range.days.slice(week*7,week*7+7).map(day=><td key={day} className={`align-top border-t border-r border-vx-border p-2 ${day===currentDay?'bg-vx-accent/10':''}`}
                        onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-veyrnox-post'))e.preventDefault();}} onDrop={e=>drop(e,day)} data-calendar-day={day}>
                        <div className="min-h-28"><h3 className="text-xs font-bold mb-2">{dayLabel(day)}{day===currentDay&&<span className="sr-only">, today</span>}</h3>
                        <ul className="space-y-2">{groups.get(day).map(post=><li key={post.id}><PostCard post={post} onEdit={()=>setEdit({post,value:localInput(post.scheduled_at)})}/></li>)}</ul></div>
                    </td>)}</tr>)}</tbody>
                </table>
            </div>}
            {result.next&&<div className="text-sm"><p className="text-vx-fg-muted mb-2">Showing {posts.length} posts. Load more to see the rest of this period.</p><button type="button" className={button} disabled={moreLoading} onClick={more}>{moreLoading?'Loading…':'Load more posts'}</button></div>}
        </>}
        {edit&&<RescheduleDialog key={`${edit.post.id}:${edit.value}`} {...edit} timezone={timezone} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);setMessage('Post rescheduled.');setRefresh(n=>n+1);}}/>}
    </div>;
}

function PostCard({post,onEdit}) {
    return <article className="rounded-lg border border-vx-border bg-vx-panel p-2 space-y-2 break-words" draggable={post.can_reschedule===true}
        onDragStart={e=>{if(!post.can_reschedule){e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-veyrnox-post',post.id);}} data-calendar-post={post.id}>
        <p className="text-xs font-bold"><time dateTime={post.scheduled_at}>{timeLabel(post.scheduled_at)}</time> · {post.status}</p>
        <p className="text-sm line-clamp-3">{post.global_text||'Media post'}</p>
        <ul className="text-xs text-vx-fg-muted space-y-1">{(post.targets||[]).map(t=><li key={t.id} className="flex flex-wrap items-center gap-1"><NetworkLogo network={t.network} className="h-3.5 w-3.5" />{networkLabel(t.network)}: {t.publish_status==='delivered'?'delivered, finish in TikTok':t.publish_status==='submitted'?'in progress':t.publish_status}
            {t.publish_status==='published'&&/^https:\/\//.test(t.platform_post_url||'')&&<> · <a href={t.platform_post_url} target="_blank" rel="noreferrer" className="underline">View post</a></>}
        </li>)}</ul>
        {post.can_reschedule?<button type="button" className="text-xs font-bold text-vx-accent underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" onClick={onEdit}>Reschedule<span className="sr-only"> {post.global_text||'media post'}</span></button>:<p className="text-xs text-vx-fg-muted">Schedule locked</p>}
    </article>;
}

function RescheduleDialog({post,value,timezone,onClose,onSaved}) {
    const [when,setWhen]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const inputRef=useRef(null);
    const proposed=localSchedule(when);
    async function save(e){
        e.preventDefault();setError('');
        const iso=localSchedule(when);
        if(!iso||Date.parse(iso)<=Date.now()+60000){setError('Choose a valid local time more than one minute from now. Daylight saving gaps are not valid times.');return;}
        setBusy(true);
        try{await rescheduleSocialPost(post.id,post.scheduled_at,iso);onSaved();}
        catch(err){setError(['POST_STARTED','SCHEDULE_CHANGED','POST_BUSY'].includes(err?.code)?'This post changed, is busy or publishing has started. Close this form and refresh the calendar.'
            :err?.code==='rate_limited'?'Too many changes. Wait a moment and try again.':'Could not reschedule. Check your connection and try again.');}
        finally{setBusy(false);}
    }
    return <Modal onCancel={()=>{if(!busy)onClose();}} initialFocusRef={inputRef} className="items-center justify-center p-4" aria-labelledby="reschedule-title">
        <form onSubmit={save} className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-base p-5 space-y-4">
            <h2 id="reschedule-title" className="font-bold text-lg">Reschedule post</h2>
            <p className="text-sm break-words line-clamp-3">{post.global_text||'Media post'}</p>
            <p className="text-xs text-vx-fg-muted">Current: {new Date(post.scheduled_at).toLocaleString()} · {timezone}. All targets move together. Publishing must not have started.</p>
            <label className="block text-sm font-bold">New date and time<input ref={inputRef} type="datetime-local" required className={`${input} mt-2 block w-full`} value={when} disabled={busy} onChange={e=>setWhen(e.target.value)}/></label>
            {proposed&&<p className="text-xs text-vx-fg-muted">New time in UTC: {proposed}. Repeated daylight-saving hours follow your browser&apos;s chosen offset.</p>}
            {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
            <div className="flex flex-wrap gap-3"><button type="submit" className={`${button} bg-vx-accent text-black`} disabled={busy}>{busy?'Saving…':'Confirm new time'}</button><button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button></div>
        </form>
    </Modal>;
}
