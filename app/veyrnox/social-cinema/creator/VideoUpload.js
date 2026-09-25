'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { Button } from '../../_components/Button';
import { uploadChunks, fileFingerprint } from './tusUpload';
import { MAX_UPLOAD_BYTES } from '../../../../lib/cinema/uploadPolicy';
export function VideoUpload({content,onClose}) {
  const [upload,setUpload]=useState(null),[state,setState]=useState('loading'),[error,setError]=useState(''),[progress,setProgress]=useState(0);
  const file=useRef(null),controller=useRef(null),active=useRef(true),attempt=useRef(null);
  useEffect(()=>{
    active.current=true;
    gatewayFetch(`/cinema/uploads?content_id=${encodeURIComponent(content.id)}`).then(data=>{if(active.current){setUpload(data.upload);setState('ready');}}).catch(e=>{if(active.current){setError(copy(e.code));setState('blocked');}});
    return ()=>{active.current=false;controller.current?.abort();};
  },[content.id]);
  async function refresh() {
    setState('checking');setError('');
    try { const data=await gatewayFetch('/cinema/uploads/refresh',{method:'POST',body:JSON.stringify({content_id:content.id}),headers:{'idempotency-key':crypto.randomUUID()}}); if(active.current){setUpload(data.upload);setState('ready');} }
    catch(e){if(active.current){setError(copy(e.code));setState('ready');}}
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
    } catch(e){if(active.current&&controller.current===operation){setState('ready');setError(e.name==='AbortError'?'Upload paused. Select the same file and resume.':e.message==='different_file'?'Select the original file to resume. Contact support to replace this video.':copy(e.code));}}
  }
  const busy=state==='uploading';
  const status=upload?({provisioning:'The upload reservation is being prepared. If it stays here, contact support; creating another reservation will not help.',uploading:'Ready to upload or resume the original file.',processing:'Video received. Stream is processing it.',ready:'Video processing is complete. It remains private and has not been reviewed or published.',error:'The video could not be accepted. Contact support before trying a replacement.',expired:'The upload window has expired. Contact support to release or replace this reservation.'})[upload.state]: 'Attach a video to this private draft.';
  return <section className="mt-6 max-w-2xl space-y-5" aria-labelledby="video-upload-title">
    <h3 id="video-upload-title" className="break-words text-xl font-bold">Video for {content.title}</h3>
    <p className="text-sm text-vx-fg-body">Up to 2 GiB and 10 minutes. Uploads go directly to Cloudflare Stream and remain private. You can pause and resume with the same file within one hour.</p>
    {state==='loading'?<p role="status">Loading upload status…</p>:<p role="status">{status}</p>}
    {state!=='loading'&&state!=='blocked'&&(!upload||upload.state==='uploading')&&<form onSubmit={send} className="space-y-4">
      <label className="block font-semibold" htmlFor="cinema-video-file">Video file<input id="cinema-video-file" ref={file} type="file" accept="video/mp4,video/webm,video/quicktime" required disabled={busy} className="mt-2 block w-full min-w-0 rounded-xl border border-vx-border p-3 text-sm" /></label>
      <progress aria-label="Video upload progress" value={progress} max={100} className="w-full accent-vx-accent" /><p className="text-sm" aria-live="polite">{progress}% uploaded</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy?'Uploading…':upload?'Resume upload':'Upload video'}</Button>{busy&&<Button type="button" variant="ghost" onClick={()=>{controller.current?.abort();setState('ready');setError('Upload paused. Select the same file and resume.');}}>Pause</Button>}</div>
    </form>}
    {error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-3">{upload&&<Button variant="ghost" disabled={busy||state==='checking'} onClick={refresh}>{state==='checking'?'Checking…':'Refresh processing status'}</Button>}<Button variant="ghost" onClick={onClose}>Back to drafts</Button></div>
  </section>;
}
function copy(code){return ({uploads_not_open:'Video uploads are not open yet.',upload_not_allowed:'This draft is unavailable, or your account cannot upload videos.',upload_capacity_reached:'The preview upload capacity is full. Contact support.',rate_limited:'Too many requests. Wait a minute and try again.',upload_exists:'This draft already has a different video reserved. Contact support for a replacement.',upload_needs_reconciliation:'The provider response needs checking. Contact support before retrying.'})[code]||'The upload could not finish. Refresh its status, then select the same file to resume. If it remains unavailable, contact support.';}
