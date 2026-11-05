'use client';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { useState } from 'react';
import { AdminPanel, AdminTable, adminControl, adminWhen } from '../_components/AdminPanel';
import { useAdminMutation } from '../_components/useAdminMutation';
import { AiControls } from './AiControls';
import { RUNTIME_SWITCHES, runtimeSwitchState } from '../../../../../lib/runtimeSwitches';
export default function Page() {
  return <><AppNav /><Main><AdminPanel title="On/off switches" endpoint="/admin/switches" description="Pause new activity without changing deployment settings.">
    {(data,refresh,offline) => <Switches data={data} refresh={refresh} offline={offline} />}
  </AdminPanel></Main></>;
}
function Switches({data,refresh,offline}) {
  const [key,setKey]=useState('generation'),[state,setState]=useState('off'),[reason,setReason]=useState(''),[touched,setTouched]=useState(false);
  const mutation=useAdminMutation('/admin/switches',refresh);
  const invalid=!reason.trim() || reason.trim().length>500 || /[\x00-\x1f\x7f]/.test(reason);
  return <>
    <p className="rounded-xl border border-vx-border p-4">A switch can only pause what the deploy has on. “Deployment controlled” preserves all existing deployment gates; it does not guarantee a feature is available. Overrides reach active Workers within 15 seconds when reads succeed; a request on an expired cache waits up to approximately 0.4 seconds for refresh. On timeout or error, switches retain their last good values, including pauses, with a five-second retry back-off. A never-loaded cache fails open for kill switches and leaves enable switches off.</p>
    <p>Generation and chat pause new work; existing job keys can replay or recover. Publishing checkpoints and Cinema settlement continue. Telemetry records hourly aggregates only when enabled. Support intake accepts stored tickets only when enabled; replies do not send email.</p>
    <ul className="list-disc pl-6">
      <li>Generation: POST /api/v1/generations, including developer/generations and MCP generation calls.</li>
      <li>Chat: POST /api/v1/chat/threads/:id/messages.</li>
      <li>Publish: scheduled socialPublishSweep dispatch and claim of new targets; draft/create APIs remain available.</li>
      <li>Cinema: POST/PUT/PATCH under /api/v1/cinema for play, unlocks, pass, uploads, uploads/from-library, content, content/submit, comments, votes, voting, story-polls and story-choices.</li>
      <li>Telemetry: Worker response aggregation and telemetry_ingest. Support intake: POST /api/v1/support/tickets and support_ticket_create.</li>
    </ul>
    <p>Not covered by generation: POST /api/v1/editor/server-render (and its quote), POST /api/v1/voice-profiles/:profileId/speech, paid editor exports through server-render, and POST /api/v1/montage/plan. Browser export reservations at POST /api/v1/library/editor-renders are also ungated but do not themselves debit Credits or invoke a render provider. Approved montage execution uses the gated generations endpoint. Film Studio POST /api/v1/film-studio and PUT /api/v1/film-studio/:id save metadata and are ungated; these saves do not themselves invoke generation providers. Voice-profile creation and verification are also outside these switches. No switch here pauses every provider-spending path.</p>
    <AdminTable title="Runtime overrides" rows={data.switches} columns={[
      {key:'key',label:'Feature',render:v=>RUNTIME_SWITCHES[v]?.label||v},
      {key:'state',label:'Effective override',render:(v,row)=>runtimeSwitchState(row.key,v)},
      {key:'updated_by',label:'Last changed by',render:v=>v||'No override'},
      {key:'updated_at',label:'Changed (UTC)',render:adminWhen},{key:'reason',label:'Reason',render:v=>v||'No change recorded'},
    ]} />
    {data.permissions.includes('switches.write') && <form className="mt-8 grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();setTouched(true);if(!invalid) mutation.save({key,state,reason:reason.trim()});}}>
      <h2 className="font-vx text-xl font-bold sm:col-span-2">Change an override</h2>
      <label className="grid gap-2">Feature<select className={adminControl} value={key} onChange={e=>setKey(e.target.value)}>{Object.entries(RUNTIME_SWITCHES).map(([id,r])=><option key={id} value={id}>{r.label}</option>)}</select></label>
      <label className="grid gap-2">State<select className={adminControl} value={state} onChange={e=>setState(e.target.value)}><option value="off">{RUNTIME_SWITCHES[key].kind==='kill'?'Pause new activity':'Off'}</option><option value="on">{RUNTIME_SWITCHES[key].kind==='kill'?'Use deployment gates':'Enable'}</option></select></label>
      <label className="grid gap-2 sm:col-span-2">Reason — no secrets<textarea className={adminControl} required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} onBlur={()=>setTouched(true)} aria-invalid={touched&&invalid} aria-describedby={touched&&invalid?'switch-reason-error':undefined}/>{touched&&invalid&&<span id="switch-reason-error" className="text-vx-danger">Enter 1–500 characters without control characters.</span>}</label>
      <p className="sm:col-span-2">Changes require an authenticator verification within five minutes.</p>
      <button className={adminControl+' min-h-13 border-vx-accent text-vx-accent'} disabled={mutation.pending||offline}>{mutation.pending?'Saving override…':'Save override'}</button>
      {mutation.signIn && <button type="button" className={adminControl} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required',{detail:{mode:'sign_in'}}))}>Sign in again</button>}
      <div className="sm:col-span-2" aria-live="polite">{mutation.error&&<p role="alert" className="text-vx-danger">{mutation.error}</p>}{mutation.message&&<p role="status">{mutation.message}</p>}</div>
    </form>}
    {data.permissions.includes('switches.write') && <AiControls offline={offline} />}
  </>;
}
