'use client';
import { useState } from 'react';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AdminPanel,AdminTable,adminControl,adminWhen } from '../_components/AdminPanel';
import { useAdminMutation } from '../_components/useAdminMutation';
export default function Page() {
  const [ticket,setTicket]=useState(''),[status,setStatus]=useState(''),[before,setBefore]=useState(null);
  const query=new URLSearchParams(ticket?{ticket}:status?{status}:{});if(before)query.set('before',JSON.stringify(before));
  const choose=id=>{setTicket(id);setBefore(null);};
  return <><AppNav /><Main><AdminPanel title="Support" endpoint={'/admin/support?'+query} description="Private ticket inbox. Replies are stored here; no email is sent.">
    {(data,refresh,offline)=><>
      <p>Intake is off until an owner enables it. There is no user-facing support form in this build. No AI agent is connected or invoked.</p>
      {!ticket?<>
        <label className="grid gap-2">Status<select className={adminControl} value={status} onChange={e=>{setStatus(e.target.value);setBefore(null);}}><option value="">All statuses</option>{['open','pending','solved'].map(s=><option key={s}>{s}</option>)}</select></label>
        <p>Intake: {data.intake?'enabled':'off'}. {status&&'Showing '+status+' tickets. Try All statuses or refresh if none appear.'}</p>
        {status&&<button type="button" className={adminControl} onClick={()=>{setStatus('');setBefore(null);}}>Clear status filter</button>}
        <AdminTable title="Inbox" rows={data.tickets||[]} empty="No tickets in this window. Clear the status filter or refresh after intake opens." columns={[
          {key:'subject',label:'Subject',render:(v,r)=><button type="button" className={adminControl} onClick={()=>choose(r.id)}>{v}</button>},{key:'email',label:'Email'},{key:'status',label:'Status'},
          {key:'category',label:'Category'},{key:'priority',label:'Priority'},{key:'assignee',label:'Assignee ID'},{key:'created_at',label:'Created (UTC)',render:adminWhen}]} />
      </>:<>
        <button type="button" className={adminControl} onClick={()=>choose('')}>Back to inbox</button>
        {data.ticket?.id===ticket&&<Thread data={data} refresh={refresh} offline={offline}/>}
      </>}
      <div className="mt-4 flex gap-3">{before&&<button type="button" className={adminControl} onClick={()=>setBefore(null)}>Newest records</button>}{data.next&&<button type="button" className={adminControl} onClick={()=>setBefore(data.next)}>Older records</button>}</div>
    </>}
  </AdminPanel></Main></>;
}
function Thread({data,refresh,offline}) {
  const [body,setBody]=useState(''),[status,setStatus]=useState(data.ticket.status),[assignee,setAssignee]=useState(data.ticket.assignee||'');
  const [touched,setTouched]=useState(false);
  const mutation=useAdminMutation('/admin/support',refresh);
  const write=data.permissions.includes('support.write')&&data.ticket.user_id;
  const invalid=!body.trim()||body.length>5000;
  const badAssignee=assignee&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assignee);
  const save=(action,fields)=>mutation.save({action,ticket:data.ticket.id,reason:'support-'+action,...fields});
  return <>
    <h2 className="mt-6 text-xl font-bold break-words">{data.ticket.subject}</h2><p>{data.ticket.email} · {data.ticket.status}</p>
    <section aria-label="Ticket messages" className="mt-4 grid gap-4">{[...(data.messages||[])].reverse().map(m=><article className="rounded-xl border border-vx-border p-4" key={m.id}><p>{m.author_kind}: {m.author_label} · {adminWhen(m.created_at)}</p><p className="mt-2 whitespace-pre-wrap break-words">{m.body}</p></article>)}</section>
    {write?<>
      <form className="mt-6 grid gap-3" onSubmit={e=>{e.preventDefault();setTouched(true);if(!invalid)save('reply',{body:body.trim()});}}>
        <label className="grid gap-2">Store a reply (no email)<textarea required maxLength={5000} value={body} className={adminControl} onChange={e=>setBody(e.target.value)} onBlur={()=>setTouched(true)} aria-invalid={touched&&invalid} aria-describedby={touched&&invalid?'reply-error':undefined}/></label>
        {touched&&invalid&&<p id="reply-error" className="text-vx-danger">Enter 1–5,000 characters.</p>}
        <button className={adminControl+' min-h-13'} disabled={offline||mutation.pending}>{mutation.pending?'Saving…':'Store reply'}</button>
      </form>
      <div className="mt-6 grid gap-3"><label className="grid gap-2">Status<select value={status} onChange={e=>setStatus(e.target.value)} className={adminControl}>{['open','pending','solved'].map(s=><option key={s}>{s}</option>)}</select></label><button className={adminControl} disabled={offline||mutation.pending} onClick={()=>save('status',{status})}>Save status</button>
        <label className="grid gap-2">Assignee user ID (owner or support; blank unassigns)<input value={assignee} onChange={e=>setAssignee(e.target.value)} className={adminControl} maxLength={36} aria-invalid={!!badAssignee}/>{badAssignee&&<span className="text-vx-danger">Enter a valid user UUID or leave blank.</span>}</label>
        {data.actor_user_id&&<button type="button" className={adminControl} disabled={offline||mutation.pending} onClick={()=>{setAssignee(data.actor_user_id);save('assign',{assignee:data.actor_user_id});}}>Assign to me</button>}
        <button className={adminControl} disabled={offline||mutation.pending||!!badAssignee} onClick={()=>save('assign',{assignee:assignee||null})}>Save assignment</button>
      </div>
    </>:<p className="mt-4">This thread is read-only{!data.ticket.user_id?' because the account was erased':''}.</p>}
    {mutation.signIn&&<button type="button" className={adminControl} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required',{detail:{mode:'sign_in'}}))}>Sign in again</button>}
    <div aria-live="polite">{mutation.error&&<p role="alert" className="text-vx-danger">{mutation.error}</p>}{mutation.message&&<p role="status">{mutation.message} No email was sent.</p>}</div>
    <AdminTable title="Latest 100 agent runs" rows={data.runs||[]} empty="No agent connected." columns={[{key:'agent_name',label:'Agent'},{key:'action',label:'Action'},{key:'summary',label:'Summary'},{key:'outcome',label:'Outcome'},{key:'created_at',label:'When (UTC)',render:adminWhen}]} />
  </>;
}
