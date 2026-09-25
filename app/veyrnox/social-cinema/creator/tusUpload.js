import { validUploadUrl, UPLOAD_CHUNK_BYTES, MAX_UPLOAD_BYTES } from '../../../../lib/cinema/uploadPolicy.js';
// A resumable transfer never forwards the application's Authorization header.
// Each resume reads the provider's offset, including after a lost PATCH response.
export async function uploadChunks(file,url,{signal,onProgress=()=>{},fetcher=fetch}={}) {
  if(!validUploadUrl(url)||file.size<1||file.size>MAX_UPLOAD_BYTES) throw Error('invalid_upload');
  const send=(method,headers={},body)=>fetcher(url,{method,headers:{'Tus-Resumable':'1.0.0',...headers},body,
    signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'});
  const head=await send('HEAD');
  const rawOffset=head.headers.get('upload-offset'),rawLength=head.headers.get('upload-length');
  if(!head.ok||!/^\d+$/.test(rawOffset||'')||Number(rawLength)!==file.size) throw Error('resume_failed');
  let offset=Number(rawOffset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>file.size) throw Error('resume_failed');
  onProgress(offset,file.size);
  while(offset<file.size) {
    const end=Math.min(offset+UPLOAD_CHUNK_BYTES,file.size);
    const res=await send('PATCH',{'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},file.slice(offset,end));
    if(res.body) await res.body.cancel();
    if(res.status!==204||Number(res.headers.get('upload-offset'))!==end) throw Error('transfer_interrupted');
    offset=end;onProgress(offset,file.size);
  }
}
// Prevent accidental resume with a different file; this is not a security or
// copyright hash. Only small samples are read, never the entire 2 GiB file.
export async function fileFingerprint(file) {
  const prefix=new TextEncoder().encode(`${file.name}:${file.size}:${file.lastModified}:`);
  const first=new Uint8Array(await file.slice(0,65536).arrayBuffer());
  const last=new Uint8Array(await file.slice(Math.max(0,file.size-65536)).arrayBuffer());
  const bytes=new Uint8Array(prefix.length+first.length+last.length);bytes.set(prefix);bytes.set(first,prefix.length);bytes.set(last,prefix.length+first.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
