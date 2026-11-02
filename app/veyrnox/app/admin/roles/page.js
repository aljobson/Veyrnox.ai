'use client';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { useState } from 'react';
import { AdminPanel, AdminTable, adminControl, adminWhen } from '../_components/AdminPanel';
import { useAdminMutation } from '../_components/useAdminMutation';
import { ADMIN_ROLES } from '../../../../../lib/adminPermissions';
export default function Page() {
  return <><AppNav /><Main><AdminPanel title="Roles" endpoint="/admin/roles" description="Roles govern the new admin sections. Existing admin routes still use their existing administrator gates.">
    {(data,refresh,offline) => <Roles data={data} refresh={refresh} offline={offline} />}
  </AdminPanel></Main></>;
}
function Roles({ data,refresh,offline }) {
  const [target,setTarget]=useState(''), [role,setRole]=useState('viewer'), [action,setAction]=useState('set'), [reason,setReason]=useState('');
  const [touched,setTouched]=useState(false);
  const [targetTouched,setTargetTouched]=useState(false);
  const mutation=useAdminMutation('/admin/roles',refresh);
  const reasonInvalid = !reason.trim() || reason.trim().length > 500 || /[\x00-\x1f\x7f]/.test(reason);
  return <>
    <p className="text-vx-fg-body">Revoking a role does not clear users.is_admin. An owner must use the existing SQL process to remove that outer administrator access. You cannot change your own role; at least one active owner must remain. Role changes require an authenticator verification within five minutes.</p>
    <AdminTable title="Administrator roles" rows={data.roles} columns={[
      {key:'email',label:'Administrator'},{key:'is_admin',label:'Outer admin gate',render:v=>v?'On':'Off'},
      {key:'role',label:'Role',render:v=>v||'No role'},{key:'created_at',label:'Role granted (UTC)',render:adminWhen},
    ]} />
    {data.permissions.includes('roles.write') && <form className="mt-8 grid gap-4 sm:grid-cols-2" onSubmit={e => {e.preventDefault();setTouched(true);if(target && !reasonInvalid) mutation.save({target_user:target,action,...(action==='set'?{role}:{}),reason:reason.trim()});}}>
      <h2 className="font-vx text-xl font-bold sm:col-span-2">Change a role</h2>
      <label className="grid gap-2">Administrator
        <select className={adminControl} required value={target} onChange={e=>setTarget(e.target.value)} onBlur={()=>setTargetTouched(true)} aria-invalid={targetTouched&&!target} aria-describedby={targetTouched&&!target?'role-target-error':undefined}>
          <option value="">Choose an administrator</option>
          {data.roles.filter(r=>r.user_id!==data.actor_user_id).map(r=><option key={r.user_id} value={r.user_id}>{r.email}</option>)}
        </select>
        {targetTouched&&!target&&<span id="role-target-error" className="text-vx-danger">Choose an administrator other than yourself.</span>}
      </label>
      <label className="grid gap-2">Action<select className={adminControl} value={action} onChange={e=>setAction(e.target.value)}><option value="set">Set role</option><option value="revoke">Revoke role</option></select></label>
      {action==='set' && <label className="grid gap-2">Role<select className={adminControl} value={role} onChange={e=>setRole(e.target.value)}>{ADMIN_ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select></label>}
      <label className="grid gap-2 sm:col-span-2">Reason — no secrets
        <textarea className={adminControl} required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} onBlur={()=>setTouched(true)} aria-invalid={touched && reasonInvalid} aria-describedby={touched && reasonInvalid?'role-reason-error':undefined} />
        {touched && reasonInvalid && <span id="role-reason-error" className="text-vx-danger">Enter 1–500 characters without control characters.</span>}
      </label>
      <button type="submit" className={adminControl+' min-h-13 border-vx-accent text-vx-accent'} disabled={mutation.pending||offline}>{mutation.pending?'Saving role…':'Save role change'}</button>
      {mutation.signIn && <button type="button" className={adminControl} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required',{detail:{mode:'sign_in'}}))}>Sign in again</button>}
      <div className="sm:col-span-2" aria-live="polite">{mutation.error && <p role="alert" className="text-vx-danger">{mutation.error}</p>}{mutation.message && <p role="status">{mutation.message}</p>}</div>
    </form>}
  </>;
}
