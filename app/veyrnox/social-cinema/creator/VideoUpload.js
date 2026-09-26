'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { Button } from '../../_components/Button';
import { uploadChunks, fileFingerprint } from './tusUpload';
import { MAX_UPLOAD_BYTES } from '../../../../lib/cinema/uploadPolicy';
export function VideoUpload({content,onClose}) {
  const [upload,setUpload]=useState(null),[state,setState]=useState('loading'),[error,setError]=useState(''),[progress,setProgress]=useState(0);
  const [confirmRemoval,setConfirmRemoval]=useState(false);
  const file=useRef(null),controller=useRef(null),active=useRef(true),attempt=useRef(null);
  const removalAttempt=useRef(null),keepButton=useRef(null),removeButton=useRef(null);
  useEffect(()=>{if(confirmRemoval)keepButton.current?.focus();else removeButton.current?.focus();},[confirmRemoval]);
  useEffect(()=>{
    active.current=true;
    gatewayFetch(`/cinema/uploads?content_id=${encodeURIComponent(content.id)}`).then(data=>{if(active.current){setUpload(data.upload);setState('ready');}}).catch(e=>{if(active.current){setError(copy(e.code));setState('blocked');}});
    return ()=>{active.current=false;controller.current?.abort();};
  },[content.id]);
  async function refresh() {
    setState('checking');setError('');
    try { const data=await gatewayFetch('/cinema/uploads/refresh',{method:'POST',body:JSON.stringify({content_id:content.id}),headers:{'idempotency-key':crypto.randomUUID()}}); if(active.current){setUpload(data.upload);setState('ready');if(!data.upload){attempt.current=null;setProgress(0);}} }
    catch(e){if(active.current){setError(copy(e.code));setState('ready');}}
  }
  async function remove() {
    const uploadId=upload?.id;
    if(!uploadId)return;
    controller.current?.abort();setState('removing');setError('');
    if(removalAttempt.current?.id!==uploadId)removalAttempt.current={id:uploadId,key:crypto.randomUUID()};
    try {
      const data=await gatewayFetch('/cinema/uploads/remove',{method:'POST',body:JSON.stringify({content_id:content.id,upload_id:uploadId}),headers:{'idempotency-key':removalAttempt.current.key}});
      if(active.current){setUpload(data.upload);setConfirmRemoval(false);setState('ready');attempt.current=null;setProgress(0);}
    } catch(e){if(active.current){setError(copy(e.code));setState('ready');}}
  }
  async function send(event) {
    event.preventDefault();
    const chosen=file.current?.files?.[0];
    if(!chosen||chosen.size<1||chosen.size>MAX_UPLOAD_BYTES||!['video/mp4','video/webm','video/quicktime'].includes(chosen.type)){setError('Choose an MP4, WebM or MOV video up to 2 GiB.');return;}
    setState('uploading');setError('');const operation=new AbortController();controller.current=operation;
    try {
      const fingerprint=await fileFingerprint(chosen);
      if(!active.current||operation.signal.aborted) return;
      if(upload&&upload.fingerprint!==fingerprint) throw Error('different_file');
      if(attempt.current?.fingerprint!==fingerprint) attempt.current={fingerprint,key:crypto.randomUUID()};
      const data=await gatewayFetch('/cinema/uploads',{method:'POST',body:JSON.stringify({content_id:content.id,file_size:chosen.size,fingerprint}),headers:{'idempotency-key':attempt.current.key}});
      if(!active.current||operation.signal.aborted) return;
      setUpload(data.upload);
      if(!data.upload?.upload_url){setState('ready');return;}
      await uploadChunks(chosen,data.upload.upload_url,{signal:operation.signal,onProgress:(done,total)=>{if(active.current)setProgress(Math.floor(done/total*100));}});
      if(active.current) await refresh();
    } catch(e){if(active.current&&controller.current===operation){setState('ready');setError(e.name==='AbortError'?'Upload paused. Select the same file and resume.':e.message==='different_file'?'Select the original file to resume. Remove the current video before uploading a replacement.':copy(e.code));}}
  }
  const busy=state==='uploading'||state==='removing';
  const status=upload?({provisioning:'The upload reservation is being prepared. If it stays here, contact support; creating another reservation will not help.',uploading:'Ready to upload or resume the original file.',processing:'Video received. Stream is processing it.',ready:'Video processing is complete. It remains private and has not been reviewed or published.',error:'The video could not be accepted. Remove it before uploading a replacement.',expired:'The upload window has expired. Remove this video before starting again.',deleting:'Removal requested. Your draft is safe. This can take a few minutes; refresh to check. You can upload a replacement after removal is confirmed.'})[upload.state]: 'Attach a video to this private draft.';
  return <section className="mt-6 max-w-2xl space-y-5" aria-labelledby="video-upload-title">
    <h3 id="video-upload-title" className="break-words text-xl font-bold">Video for {content.title}</h3>
    <p className="text-sm text-vx-fg-body">Up to 2 GiB and 10 minutes. Uploads go directly to Cloudflare Stream and remain private. You can pause and resume with the same file within one hour.</p>
    {state==='loading'?<p role="status">Loading upload status…</p>:<p role="status">{status}</p>}
    {state!=='loading'&&state!=='blocked'&&!confirmRemoval&&(!upload||upload.state==='uploading')&&<form onSubmit={send} className="space-y-4">
      <label className="block font-semibold" htmlFor="cinema-video-file">Video file<input id="cinema-video-file" ref={file} type="file" accept="video/mp4,video/webm,video/quicktime" required disabled={busy} className="mt-2 block w-full min-w-0 rounded-xl border border-vx-border p-3 text-sm" /></label>
      <progress aria-label="Video upload progress" value={progress} max={100} className="w-full accent-vx-accent" /><p className="text-sm" aria-live="polite">{progress}% uploaded</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy?'Uploading…':upload?'Resume upload':'Upload video'}</Button>{busy&&<Button type="button" variant="ghost" onClick={()=>{controller.current?.abort();setState('ready');setError('Upload paused. Select the same file and resume.');}}>Pause</Button>}</div>
    </form>}
    {confirmRemoval&&<div role="group" aria-labelledby="remove-video-title" className="space-y-3 rounded-xl border border-vx-border p-4">
      <h4 id="remove-video-title" className="font-semibold">Remove this video?</h4>
      <p className="text-sm text-vx-fg-body">This permanently removes the attached video. Your draft, title and description stay. Removal cannot be undone; keep your original file if you want to upload it again.</p>
      <div className="flex flex-wrap gap-3"><Button ref={keepButton} variant="ghost" disabled={busy} onClick={()=>{setConfirmRemoval(false);removeButton.current?.focus();}}>Keep video</Button><Button variant="danger" disabled={busy} onClick={remove}>{state==='removing'?'Requesting removal…':'Remove video permanently'}</Button></div>
    </div>}
    {error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-3">{upload&&<Button variant="ghost" disabled={busy||state==='checking'||confirmRemoval} onClick={refresh}>{state==='checking'?'Checking…':'Refresh status'}</Button>}{upload&&!['provisioning','deleting'].includes(upload.state)&&!confirmRemoval&&<Button ref={removeButton} variant="ghost" disabled={busy||state==='checking'} onClick={()=>{setError('');setConfirmRemoval(true);}}>Remove video</Button>}<Button variant="ghost" onClick={onClose}>Back to drafts</Button></div>
  </section>;
}
function copy(code){return ({uploads_not_open:'This video action is not open yet.',upload_not_allowed:'This draft is unavailable, or your account cannot manage its video.',upload_capacity_reached:'The preview storage or daily upload limit is reached. Removing a video frees storage only after confirmation; the daily limit still applies.',rate_limited:'Too many requests. Wait a minute and try again.',upload_exists:'This draft already has a different video reserved. Remove it before uploading a replacement.',upload_removed:'That upload was removed. Refresh status before choosing a new video.',upload_needs_reconciliation:'The provider response needs checking. Contact support before retrying.'})[code]||'The video action could not finish. Refresh its status and try again. If it remains unavailable, contact support.';}
