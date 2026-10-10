import { STUDIO_FOLDERS, SHOT_LANES, assetKey, isLocked, referenceSheet, shotAssets, testMatrix, testPrompt } from './filmStudio.js';
import { parseFilm } from './filmStudioStorage.js';
const cell = v => String(v ?? '').replaceAll('|','\\|').replaceAll('\n','<br>');
const table = (head, rows) => `| ${head.join(' | ')} |\n| ${head.map(()=>'---').join(' | ')} |\n${rows.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}\n`;
const safe = name => name.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,100)||'film-studio';
export const filmFilename = film => safe(film.name);
export function studioFiles(film) {
  parseFilm(JSON.stringify(film));
  const config=`## AI film studio\n\n### Image models\n- ${film.stack.image} — access: ${film.stack.imageAccess}\n\n### Video model\n- ${film.stack.video} — access: ${film.stack.videoAccess}\n\n### Working defaults\n- Clip length habit: ${film.stack.seconds} seconds\n- Output folder: .\n- Format: ${film.stack.aspect}\n`;
  const files={};
  for(const folder of STUDIO_FOLDERS) files[`${folder}/`]='';
  files['CLAUDE.md']=config; files['AGENTS.md']=config;
  files['studio.json']=JSON.stringify(film,null,2);
  files['docs/README']=`${film.name}\n\n${STUDIO_FOLDERS.map(s=>`${s}/`).join('\n')}\n\nOnly selects/ is visible to the edit.\nOnly the prompt engineer enters generations/.\nReference files are never renamed; a new version gets a new file.\n\nReferenced media stays in your Library or source workflow. This export includes documents and prompts, not media binaries.\n`;
  files['docs/breakdown.md']='# Breakdown\n\n## Scenes\n\n'+table(['Scene / shot ID','Summary','Location','Time of day','Characters','Props','Shot-card file','Status'],film.shots.map(s=>[s.id,s.description,s.location,s.time,s.characters,s.props,`prompts/${safe(s.id)}-shot-card.md`,shotAssets(s).every(k=>isLocked(film,film.assets.find(a=>assetKey(a)===k)))?'ready':'blocked']));
  files['docs/bible.md']='# Visual Bible\n\n'+film.boards.map(b=>`## ${b.type==='style'?'Style':'Asset'} board: ${b.name}\n\n${table(['Reference','Kind','Caption'],b.references.map(r=>[r.source,r.kind,r.caption]))}\nDecision: ${b.decision}\n`).join('\n')+'\n## Ban list\n\n'+table(['Board','Reference','Forbidden property'],film.boards.flatMap(b=>b.references.filter(r=>r.kind==='anti-reference').map(r=>[b.name,r.source,r.caption])));
  files['docs/registry.md']='# Asset Registry\n\n'+table(['Tag','Type','Version','Seed file','Scenes','Status'],film.assets.map(a=>[a.tag,a.type,a.version,a.references.join(', '),film.shots.filter(s=>shotAssets(s).includes(assetKey(a))).map(s=>s.id).join(', '),isLocked(film,a)?'locked':'draft']));
  files['docs/generation-log.md']='# Generation Log\n\n'+table(['Shot ID','Prompt version','What changed','Result','Verdict'],film.attempts.map(a=>[a.shot,a.version,a.changed,a.result,a.verdict]));
  files['docs/text-tasks.md']='# Text tasks for the edit\n\n'+table(['Shot ID','Exact text','Placement','Context'],film.shots.filter(s=>s.text).map(s=>[s.id,s.text,s.textPlacement,s.textContext]));
  for(const s of film.shots) files[`prompts/${safe(s.id)}-shot-card.md`]=`# ${s.id}\n\n${SHOT_LANES.map(([lane,fields])=>`## ${lane}\n\n${table(['Field','Value'],fields.map(([k,label])=>[label,s[k]]))}`).join('\n')}`;
  for(const a of film.assets) files[`assets/${a.type}s/${a.tag.slice(1)}-v${a.version}.md`]=`# ${assetKey(a)}\nStatus: ${isLocked(film,a)?'locked':'draft'}\n\n## Canonical descriptor\n${a.descriptor}\n\n## Reference files\n${a.references.join('\n')}\n\n## Reference-sheet prompt\n${referenceSheet(a)}\n\n## Stress test\n${table(['Test','Angle','Shot size','Scene lighting','Paired asset','Prompt','Result','Verdict'],testMatrix(film,a).map(r=>[r.id,r.angle,r.size,r.light,r.pair,testPrompt(film,a,r),a.tests[r.id]?.result||'',a.tests[r.id]?.verdict||'pending']))}\nLock decision: ${isLocked(film,a)?a.lock.at:'pending'}\n`;
  for(const p of film.prompts) files[`prompts/${safe(p.shot)}-prompt-v${p.version}.md`]=p.content;
  for(const a of film.attempts.filter(a=>a.verdict==='accepted')) files[`selects/${safe(a.shot.split('-')[0])}/${safe(a.shot)}-v${a.version}.md`]=`# Accepted take\nShot: ${a.shot}\nPrompt version: ${a.version}\nOutput: ${a.result}\nAccepted: ${a.at}\n\n${a.checks.join('\n')}\n`;
  return files;
}

// Store-only ZIP keeps the document export independent of a server or compression library.
export function studioZip(film) {
  const encode=s=>new TextEncoder().encode(s), local=[], central=[];let offset=0;
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  for(const [path,content] of Object.entries(studioFiles(film))){
    const name=encode(`${filmFilename(film)}/${path}`), data=encode(content), checksum=crc(data);
    const header=new Uint8Array(30),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,checksum,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
    local.push(header,name,data);
    const entry=new Uint8Array(46),e=new DataView(entry.buffer);e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,0x800,true);e.setUint16(14,33,true);e.setUint32(16,checksum,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,name.length,true);e.setUint32(38,path.endsWith('/')?0x10:0,true);e.setUint32(42,offset,true);central.push(entry,name);offset+=header.length+name.length+data.length;
  }
  const size=central.reduce((s,b)=>s+b.length,0), end=new Uint8Array(22),e=new DataView(end.buffer),count=central.length/2;
  e.setUint32(0,0x06054b50,true);e.setUint16(8,count,true);e.setUint16(10,count,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+size+22);let at=0;for(const part of [...local,...central,end]){result.set(part,at);at+=part.length;}return result;
}
