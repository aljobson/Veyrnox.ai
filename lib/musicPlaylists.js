const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE=/^[A-Za-z0-9._-]{8,120}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
export function parsePlaylistCreate(v){if(!exact(v,['title','idempotency_key']))return{ok:false,error:'invalid_request'};const title=typeof v.title==='string'?v.title.trim():'';if(!title||title.length>80||/[\u0000-\u001f]/.test(title))return{ok:false,error:'title_invalid'};if(typeof v.idempotency_key!=='string'||!KEY_RE.test(v.idempotency_key))return{ok:false,error:'idempotency_key_invalid'};return{ok:true,title,idempotencyKey:v.idempotency_key};}
export function parsePlaylistPatch(v){
  if(v?.action==='replace'){
    if(!exact(v,['action','expected_revision','song_ids','idempotency_key']))return{ok:false,error:'invalid_request'};
    if(!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||v.expected_revision>2147483647)return{ok:false,error:'revision_invalid'};
    if(!Array.isArray(v.song_ids)||v.song_ids.length>100||new Set(v.song_ids).size!==v.song_ids.length||v.song_ids.some(id=>!UUID_RE.test(id||'')))return{ok:false,error:'song_ids_invalid'};
    if(typeof v.idempotency_key!=='string'||!KEY_RE.test(v.idempotency_key))return{ok:false,error:'idempotency_key_invalid'};
    return{ok:true,action:'replace',expectedRevision:v.expected_revision,songIds:v.song_ids.map(id=>id.toLowerCase()),idempotencyKey:v.idempotency_key};
  }
  if(v?.action==='pin'){
    if(!exact(v,['action','expected_revision','pinned','idempotency_key'])||typeof v.pinned!=='boolean')return{ok:false,error:'invalid_request'};
    if(!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||v.expected_revision>2147483647)return{ok:false,error:'revision_invalid'};
    if(typeof v.idempotency_key!=='string'||!KEY_RE.test(v.idempotency_key))return{ok:false,error:'idempotency_key_invalid'};
    return{ok:true,action:'pin',expectedRevision:v.expected_revision,pinned:v.pinned,idempotencyKey:v.idempotency_key};
  }
  return{ok:false,error:'invalid_request'};
}
