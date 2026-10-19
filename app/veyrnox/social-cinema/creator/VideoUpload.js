'use client';
import { useI18n } from '../../../../components/I18nProvider.jsx';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { Button } from '../../_components/Button';
import { uploadProxyChunks } from './proxyUpload';
import { fileFingerprint } from './tusUpload';
import { MAX_UPLOAD_BYTES } from '../../../../lib/cinema/uploadPolicy';
import { LibraryPicker } from '../../_components/LibraryPicker';
import { getFreshAccessToken } from '../../../lib/authClient';
export function VideoUpload({content,proxyUploadsEnabled=false,onClose}) {
  const { t } = useI18n();
  const [upload,setUpload]=useState(null),[state,setState]=useState('loading'),[error,setError]=useState(''),[progress,setProgress]=useState(0);
  const [proxyEnabled,setProxyEnabled]=useState(proxyUploadsEnabled);
  const [libraryEnabled,setLibraryEnabled]=useState(false);
  const [confirmRemoval,setConfirmRemoval]=useState(false),[picking,setPicking]=useState(false);
  const file=useRef(null),controller=useRef(null),active=useRef(true),attempt=useRef(null);
  const removalAttempt=useRef(null),keepButton=useRef(null),removeButton=useRef(null),libraryAttempt=useRef(null);
  useEffect(()=>{if(confirmRemoval)keepButton.current?.focus();else removeButton.current?.focus();},[confirmRemoval]);
  useEffect(()=>{
    active.current=true;
    gatewayFetch(`/cinema/uploads?content_id=${encodeURIComponent(content.id)}`).then(data=>{if(active.current){setUpload(data.upload);setProxyEnabled(data.proxy_uploads_enabled===true);setLibraryEnabled(data.library_uploads_enabled===true);setState('ready');}}).catch(e=>{if(active.current){setError(copy(e.code, t));setState('blocked');}});
    return ()=>{active.current=false;controller.current?.abort();};
  },[content.id, t]);
  async function refresh() {
    setState('checking');setError('');
    try { const data=await gatewayFetch('/cinema/uploads/refresh',{method:'POST',body:JSON.stringify({content_id:content.id}),headers:{'idempotency-key':crypto.randomUUID()}}); if(active.current){setUpload(data.upload);setProxyEnabled(data.proxy_uploads_enabled===true);setLibraryEnabled(data.library_uploads_enabled===true);setState('ready');if(!data.upload){attempt.current=null;setProgress(0);}} }
    catch(e){if(active.current){setError(copy(e.code, t));setState('ready');}}
  }
  async function remove() {
    const uploadId=upload?.id;
    if(!uploadId)return;
    controller.current?.abort();setState('removing');setError('');
    if(removalAttempt.current?.id!==uploadId)removalAttempt.current={id:uploadId,key:crypto.randomUUID()};
    try {
      const data=await gatewayFetch('/cinema/uploads/remove',{method:'POST',body:JSON.stringify({content_id:content.id,upload_id:uploadId}),headers:{'idempotency-key':removalAttempt.current.key}});
      if(active.current){setUpload(data.upload);setConfirmRemoval(false);setState('ready');attempt.current=null;setProgress(0);}
    } catch(e){if(active.current){setError(copy(e.code, t));setState('ready');}}
  }
  // From Library: the finished job remains private while exact-byte malware and
  // media checks run. One idempotency key per (draft, job) makes retry a no-op.
  async function fromLibrary(item) {
    setPicking(false);setState('copying');setError('');
    if(libraryAttempt.current?.job!==item.id) libraryAttempt.current={job:item.id,key:crypto.randomUUID()};
    try {
      const data=await gatewayFetch('/cinema/uploads/from-library',{method:'POST',body:JSON.stringify({content_id:content.id,job_id:item.id}),headers:{'idempotency-key':libraryAttempt.current.key}});
      if(active.current){setUpload(data.upload);setProxyEnabled(data.proxy_uploads_enabled===true);setLibraryEnabled(data.library_uploads_enabled===true);setState('ready');}
    } catch(e){if(active.current){setState('ready');setError(copy(e.code, t));}}
  }
  async function send(event) {
    event.preventDefault();
    const chosen=file.current?.files?.[0];
    if(!chosen||chosen.size<1||chosen.size>MAX_UPLOAD_BYTES||!['video/mp4','video/webm','video/quicktime'].includes(chosen.type)){setError(t("cinema.videoUpload.chooseAnMp4WebmOrMov"));return;}
    setState('uploading');setError('');const operation=new AbortController();controller.current=operation;
    try {
      const fingerprint=await fileFingerprint(chosen);
      if(!active.current||operation.signal.aborted) return;
      if(upload&&upload.fingerprint!==fingerprint) throw Error('different_file');
      if(attempt.current?.fingerprint!==fingerprint) attempt.current={fingerprint,key:crypto.randomUUID()};
      const data=await gatewayFetch('/cinema/uploads',{method:'POST',body:JSON.stringify({content_id:content.id,file_size:chosen.size,fingerprint}),headers:{'idempotency-key':attempt.current.key}});
      if(!active.current||operation.signal.aborted) return;
      setUpload(data.upload);
      if(!data.upload?.transfer_path){setState('ready');return;}
      await uploadProxyChunks(chosen,data.upload.transfer_path,{fetcher:gatewayFetch,signal:operation.signal,onProgress:(done,total)=>{if(active.current)setProgress(Math.floor(done/total*100));}});
      if(active.current) await refresh();
    } catch(e){if(active.current&&controller.current===operation){setState('ready');setError(e.name==='AbortError'?t("cinema.videoUpload.uploadPausedSelectTheSameFile"):e.message==='different_file'?t("cinema.videoUpload.selectTheOriginalFileToResume"):copy(e.code, t));}}
  }
  const busy=state==='uploading'||state==='copying'||state==='removing';
  const status=upload?({provisioning:upload.source_job_id?t("cinema.videoUpload.yourLibraryVideoIsPrivateWhile"):t("cinema.videoUpload.theUploadReservationIsBeingPrepared"),uploading:proxyEnabled?t("cinema.videoUpload.readyToUploadOrResumeThe"):t("cinema.videoUpload.theCheckedVideoIsBeingTransferred"),processing:upload.source_job_id?t("cinema.videoUpload.yourCheckedLibraryVideoIsProcessing"):t("cinema.videoUpload.videoReceivedStreamIsProcessingIt"),ready:t("cinema.videoUpload.videoProcessingIsCompleteItRemains"),error:t("cinema.videoUpload.theVideoCouldNotBeAccepted"),expired:t("cinema.videoUpload.theUploadWindowHasExpiredRemove"),deleting:t("cinema.videoUpload.removalRequestedYourDraftIsSafe")})[upload.state]: t("cinema.videoUpload.attachAVideoToThisPrivate");
  return <section className="mt-6 max-w-2xl space-y-5" aria-labelledby="video-upload-title">
    <h3 id="video-upload-title" className="wrap-break-word text-xl font-bold">{t('cinema.upload.title', { title: content.title })}</h3>
    <p className="text-sm text-vx-fg-body">{t("cinema.videoUpload.upTo2GibAnd10")}</p>
    {state==='loading'?<p role="status">{t("cinema.videoUpload.loadingUploadStatus")}</p>:<p role="status">{status}</p>}
    {upload?.state==='ready'&&<CreatorVideoPoster contentId={content.id} title={content.title} />}
    {!proxyEnabled&&state!=='loading'&&<p role="status">{t("cinema.videoUpload.newDeviceUploadsArePausedUntil")}{' '}{libraryEnabled?t("cinema.videoUpload.youCanStillChooseAFinished"):''}</p>}
    {(proxyEnabled||libraryEnabled)&&state!=='loading'&&state!=='blocked'&&!confirmRemoval&&(!upload||upload.state==='uploading')&&<form onSubmit={send} className="space-y-4">
      {proxyEnabled&&<><label className="block font-semibold" htmlFor="cinema-video-file">{t("cinema.videoUpload.videoFile")}<input id="cinema-video-file" ref={file} type="file" accept="video/mp4,video/webm,video/quicktime" required disabled={busy} className="mt-2 block w-full min-w-0 rounded-xl border border-vx-border p-3 text-sm" /></label>
      <progress aria-label={t("cinema.videoUpload.videoUploadProgress")} value={progress} max={100} className="w-full accent-vx-accent" /><p className="text-sm" aria-live="polite">{t('cinema.upload.progress', { count: progress })}</p></>}
      <div className="flex flex-wrap gap-3">{proxyEnabled&&<Button type="submit" disabled={busy}>{busy?t("cinema.videoUpload.uploading"):upload?t("cinema.videoUpload.resumeUpload"):t("cinema.videoUpload.uploadVideo")}</Button>}{!upload&&libraryEnabled&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>{setError('');setPicking(true);}}>{state==='copying'?t("cinema.videoUpload.checking"):t("cinema.videoUpload.fromLibrary")}</Button>}{state==='uploading'&&<Button type="button" variant="ghost" onClick={()=>{controller.current?.abort();setState('ready');setError(t("cinema.videoUpload.uploadPausedSelectTheSameFile"));}}>{t("cinema.videoUpload.pause")}</Button>}</div>
    </form>}
    {confirmRemoval&&<div role="group" aria-labelledby="remove-video-title" className="space-y-3 rounded-xl border border-vx-border p-4">
      <h4 id="remove-video-title" className="font-semibold">{t("cinema.videoUpload.removeThisVideo")}</h4>
      <p className="text-sm text-vx-fg-body">{t("cinema.videoUpload.thisRequestsPermanentRemovalOfThe")}</p>
      {!proxyEnabled&&<p>{t("cinema.videoUpload.removalWillRemainPendingUntilVerification")}</p>}
      <div className="flex flex-wrap gap-3"><Button ref={keepButton} variant="ghost" disabled={busy} onClick={()=>{setConfirmRemoval(false);removeButton.current?.focus();}}>{t("cinema.videoUpload.keepVideo")}</Button><Button variant="danger" disabled={busy} onClick={remove}>{state==='removing'?t("cinema.videoUpload.requestingRemoval"):t("cinema.videoUpload.removeVideoPermanently")}</Button></div>
    </div>}
    {picking&&<LibraryPicker kind="video" onPick={fromLibrary} onClose={()=>setPicking(false)} />}
    {error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-3">{upload&&<Button variant="ghost" disabled={busy||state==='checking'||confirmRemoval} onClick={refresh}>{state==='checking'?t("cinema.videoUpload.checking"):t("cinema.videoUpload.refreshStatus")}</Button>}{upload&&!['provisioning','deleting'].includes(upload.state)&&!confirmRemoval&&<Button ref={removeButton} variant="ghost" disabled={busy||state==='checking'} onClick={()=>{setError('');setConfirmRemoval(true);}}>{t("cinema.videoUpload.removeVideo")}</Button>}<Button variant="ghost" onClick={onClose}>{t("cinema.videoUpload.backToDrafts")}</Button></div>
  </section>;
}
function CreatorVideoPoster({contentId,title}) {
  const { t } = useI18n();
  const [src,setSrc]=useState('');
  useEffect(()=>{
    let active=true,url='';
    (async()=>{
      const token=await getFreshAccessToken();
      if(!token)return;
      const response=await fetch(`/api/v1/cinema/posters/${encodeURIComponent(contentId)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!response.ok)return;
      const blob=await response.blob();
      if(active){url=URL.createObjectURL(blob);setSrc(url);}
    })().catch(()=>{});
    return()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[contentId]);
  if(!src)return null;
  return <figure className="max-w-xl overflow-hidden rounded-2xl border border-vx-border bg-vx-panel"><Image src={src} width={1280} height={720} unoptimized alt={t('cinema.upload.poster', { title })} className="aspect-video h-auto w-full object-cover" /><figcaption className="px-4 py-3 text-sm text-vx-fg-muted">{t("cinema.videoUpload.automaticPosterFrame")}</figcaption></figure>;
}
function copy(code, t){return ({upload_safety_hold:t("cinema.videoUpload.videoUploadsAreTemporarilyPausedWhile"),uploads_not_open:t("cinema.videoUpload.thisVideoActionIsNotOpen"),upload_not_allowed:t("cinema.videoUpload.thisDraftIsUnavailableOrYour"),upload_capacity_reached:t("cinema.videoUpload.thePreviewStorageOrDailyUpload"),rate_limited:t("cinema.creatorApplication.tooManyRequestsWaitAMinute"),upload_exists:t("cinema.videoUpload.thisDraftAlreadyHasADifferent"),upload_removed:t("cinema.videoUpload.thatUploadWasRemovedRefreshStatus"),upload_needs_reconciliation:t("cinema.videoUpload.theProviderResponseNeedsCheckingContact"),source_not_found:t("cinema.videoUpload.thatLibraryVideoIsNoLonger"),source_not_video:t("cinema.videoUpload.chooseAFinishedVideoFromYour")})[code]||t("cinema.videoUpload.theVideoActionCouldNotFinish");}
