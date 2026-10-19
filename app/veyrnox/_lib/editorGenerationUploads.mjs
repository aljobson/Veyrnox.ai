import { helperEnglish } from '../../../lib/helperMessages.mjs';
import { generationSlotKind,generationMimeTypes } from '../../../lib/generationSourceSlots.mjs';
import { ALLOWED_UPLOAD_TYPES } from '../../../lib/uploadSource.js';
export function generationFileType(file) {
    if (file?.type === 'audio/x-wav' || file?.type === 'audio/wave') return 'audio/wav';
    return file?.type || '';
}
export function generationFileProblem(slot,file) {
    const kind=generationSlotKind(slot),type=generationFileType(file),spec=ALLOWED_UPLOAD_TYPES[type];
    if (!(file instanceof Blob) || !generationMimeTypes(kind).includes(type) || !spec) return helperEnglish('choose_a_supported_image_mp4_video_or_mp3wav');
    if (!file.size || file.size > spec.maxBytes) return helperEnglish('choose_a_file_between_1_byte_and_mib', { value1: spec.maxBytes/1024/1024 });
    return null;
}
/** Upload originals once per unchanged attempt; keys carry roles, never client URLs. */
export async function uploadGenerationSources(uploads,{request,put=globalThis.fetch,signal,current,keys=new Map(),onProgress=()=>{}}) {
    const assertCurrent=()=>{if(signal?.aborted)throw new DOMException('Source upload cancelled.','AbortError');if(!current())throw new Error('Account changed.');};
    const result=[];
    for(let index=0;index<uploads.length;index++) {
        assertCurrent(); const source=uploads[index],identity=`${source.slot}:${source.localId}`;
        const problem=generationFileProblem(source.slot,source.file);if(problem)throw new Error(problem);
        let key=keys.get(identity);
        if(!key) {
            onProgress({index:index+1,total:uploads.length,name:source.file.name||'Source'});
            const signed=await request('/uploads',{method:'POST',signal,body:JSON.stringify({content_type:generationFileType(source.file),size_bytes:source.file.size})});
            assertCurrent();
            const response=await put(signed.upload_url,{method:'PUT',headers:signed.headers||{'Content-Type':signed.content_type},body:source.file,signal});
            if(!response.ok)throw new Error('Source upload failed. Retry with the same files.');
            assertCurrent(); key=signed.key; keys.set(identity,key);
        }
        result.push({key,slot:source.slot});
    }
    assertCurrent();return result;
}
