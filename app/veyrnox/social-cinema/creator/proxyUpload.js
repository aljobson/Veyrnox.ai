import {UPLOAD_CHUNK_BYTES,MAX_UPLOAD_BYTES} from '../../../../lib/cinema/uploadPolicy.js';
const PATH=/^\/cinema\/uploads\/[a-f0-9-]{36}\/transfer\?content_id=[a-f0-9-]{36}$/;
// fetcher is gatewayFetch: refreshes identity and sends Bearer only to our API.
export async function uploadProxyChunks(file,path,{signal,onProgress=()=>{},fetcher}={}) {
  if(!PATH.test(path)||file.size<1||file.size>MAX_UPLOAD_BYTES||typeof fetcher!=='function') throw Error('invalid_upload');
  let {offset,length}=await fetcher(path,{method:'GET',signal});
  if(!Number.isSafeInteger(offset)||offset<0||offset>file.size||length!==file.size) throw Error('resume_failed');
  onProgress(offset,file.size);
  while(offset<file.size) {
    const end=Math.min(offset+UPLOAD_CHUNK_BYTES,file.size);
    const response=await fetcher(path,{method:'PATCH',signal,headers:{'content-type':'application/offset+octet-stream','upload-offset':String(offset)},body:file.slice(offset,end)});
    if(response.offset!==end||response.length!==file.size) throw Error('transfer_interrupted');
    offset=end;onProgress(offset,file.size);
  }
}
