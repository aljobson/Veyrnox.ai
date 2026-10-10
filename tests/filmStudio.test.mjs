import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPTANCE_CHECKS, PROMPT_BLOCKS, STYLE_BOARDS, accessibleStage, assetKey, boardIssues, buildShotPrompt, isLocked, lockAsset, logFilmAttempt, nextPromptVersion, shotIssues, stageIssues, testMatrix } from '../app/veyrnox/_lib/filmStudio.js';
import { parseFilm, readFilm, writeFilm, clearFilmLocal } from '../app/veyrnox/_lib/filmStudioStorage.js';
import { studioFiles, studioZip } from '../app/veyrnox/_lib/filmStudioExport.js';
import { filmFixture } from './fixtures/filmStudio.mjs';

function readyFilm(character=false) {
  let f=filmFixture();
  if(character)f.shots[0].characters='@cal_wet:v2';
  f.boards=[{id:'room',name:'@room:v1',type:'location',decision:'approved',references:Array.from({length:8},(_,i)=>({source:`room-${i}.png`,caption:`Room layout view ${i}`,kind:'reference'}))},
    ...STYLE_BOARDS.map(name=>({id:name,name,type:'style',decision:'approved',references:[{source:`${name}.png`,caption:`The ${name} specification`,kind:'reference'}]}))];
  f.assets=[{tag:'@room',version:1,type:'location',descriptor:'An empty rectangular room, oak floor, cream plaster walls, west window; warm amber light.',references:['room-sheet-v1.png'],tests:{},lock:null}];
  if(character){
    f.boards.push({id:'cal',name:'@cal_wet:v2',type:'character',decision:'approved',references:Array.from({length:10},(_,i)=>({source:`cal-${i}.png`,caption:`Wet wardrobe detail ${i}`,kind:'reference'}))});
    f.assets.push({tag:'@cal_wet',version:2,type:'character',descriptor:'Cal, grey eyes, black hair, navy jacket soaked dark with rain, brown boots.',references:['cal-wet-sheet-v2.png'],tests:{},lock:null});
  }
  for(const a of f.assets)a.tests=Object.fromEntries(testMatrix(f,a).map(r=>[r.id,{result:`${a.tag}-${r.id}.png`,verdict:'pass'}]));
  for(const key of f.assets.map(assetKey))f=lockAsset(f,key);
  return f;
}
const details={map:'Window 3 metres ahead, camera stays on axis.',camera:'Tripod at 1.5 metres; fixed.',timing:'0.5 second beats across 10 seconds.',physics:'Objects stay in position.',lighting:'Warm west-window light.',audio:'Room tone.',palette:'60 cream, 30 brown, 10 amber.',quality:'Stable geometry and reference match.',constraints:'One empty room; reject a changed layout.'};

test('the breakdown requires all 22 fields, exact versions, a single action and 10–15 seconds',()=>{
  const s=filmFixture().shots[0];assert.deepEqual(shotIssues(s),[]);
  for(const patch of [{lens:''},{characters:'@cal'},{location:'@room'},{seconds:'5'},{oneAction:false}])assert.ok(shotIssues({...s,...patch}).length);
  assert.ok(shotIssues({...s,text:'OPEN',textPlacement:''}).length);
});
test('boards need distinct captioned images, their type’s full count and written approval',()=>{
  const b=readyFilm().boards[0];assert.deepEqual(boardIssues(b),[]);
  assert.ok(boardIssues({...b,decision:'revise'}).length);
  assert.ok(boardIssues({...b,references:b.references.slice(0,7)}).length);
  assert.ok(boardIssues({...b,references:b.references.map(r=>({...r,source:'same.png'}))}).length);
  assert.ok(boardIssues({...b,references:[...b.references,{source:'anti.png',caption:'',kind:'anti-reference'}]}).length);
});
test('missing boards and exact variant passports block progression',()=>{
  const f=filmFixture();assert.equal(accessibleStage(f),3);
  const ready=readyFilm(true);assert.deepEqual(stageIssues(ready,5),[]);
  ready.assets=ready.assets.filter(a=>a.tag!=='@cal_wet');assert.match(stageIssues(ready,4).join(' '),/@cal_wet:v2/);
});
test('character matrix includes ten repeatability images and every real-lighting pairing',()=>{
  const f=readyFilm(true),a=f.assets[1],rows=testMatrix(f,a);
  assert.equal(rows.filter(r=>r.id.startsWith('view-')).length,10);
  assert.ok(rows.some(r=>r.pair==='@room:v1'&&r.light===f.shots[0].time));
  a.tests[rows[0].id].verdict='miss';assert.equal(isLocked(f,a),false);assert.throws(()=>lockAsset(f,assetKey(a)),/Every test/);
  a.tests[rows[0].id]={verdict:'pass',result:''};assert.throws(()=>lockAsset(f,assetKey(a)),/Every test/);
  a.tests[rows[0].id]={verdict:'pass',result:a.tests[rows[1].id].result};assert.throws(()=>lockAsset(f,assetKey(a)),/distinct output/);
});
test('changing descriptors, reference decisions, scene lighting or co-star identity invalidates locks',()=>{
  for(const change of [f=>{f.assets[0].descriptor+=' altered';},f=>{f.boards[0].decision='revise';},f=>{f.shots[0].time='night';},f=>{f.assets[1].descriptor+=' altered';}]){
    const f=readyFilm(true);change(f);assert.equal(isLocked(f,f.assets[0]),false);
    assert.throws(()=>buildShotPrompt(f,f.shots[0],details));
  }
});
test('prompts contain exactly fifteen ordered blocks, full descriptors and verbatim dialogue',()=>{
  const f=readyFilm();f.shots[0].dialogue='"I will come back."';
  f.assets[0].lock=null;const relocked=lockAsset(f,'@room:v1');
  const text=buildShotPrompt(relocked,relocked.shots[0],details);
  let previous=-1;for(let i=0;i<15;i++){const at=text.indexOf(`${i+1}. ${PROMPT_BLOCKS[i]}\n`);assert.ok(at>previous);previous=at;}
  assert.ok(text.includes(relocked.assets[0].descriptor));assert.ok(text.includes('"I will come back."'));assert.doesNotMatch(text,/negative.prompt/i);
  assert.throws(()=>buildShotPrompt(relocked,relocked.shots[0],{...details,camera:''}),/Complete every/);
});
test('revisions require the last result, change exactly one line and preserve passports',()=>{
  let f=readyFilm();const s=f.shots[0],p=nextPromptVersion(f,s,buildShotPrompt(f,s,details));f.prompts.push(p);
  const one=p.content.replace('Room tone.','Quiet room tone.');
  assert.throws(()=>nextPromptVersion(f,s,one),/Log the previous/);
  f=logFilmAttempt(f,p,{result:'raw-v1.mp4',changed:'First prompt',verdict:'rejected'});
  assert.equal(nextPromptVersion(f,s,one).version,2);
  assert.throws(()=>nextPromptVersion(f,s,one.replace('Tripod','Handheld')),/exactly one line/);
  assert.throws(()=>nextPromptVersion(f,s,p.content.replace(f.assets[0].descriptor,'A room.')),/descriptors/);
});
test('takes cannot be accepted without every quality check or logged twice',()=>{
  let f=readyFilm();const p=nextPromptVersion(f,f.shots[0],buildShotPrompt(f,f.shots[0],details));f.prompts.push(p);
  const entry={result:'accepted-v1.mp4',changed:'First prompt',verdict:'accepted',checks:ACCEPTANCE_CHECKS.slice(0,5)};
  assert.throws(()=>logFilmAttempt(f,p,entry),/six quality/);
  f=logFilmAttempt(f,p,{...entry,checks:ACCEPTANCE_CHECKS});assert.equal(f.attempts[0].verdict,'accepted');
  assert.throws(()=>logFilmAttempt(f,p,entry),/already has a result/);
});
test('fifteen failed attempts force a structural simplification',()=>{
  let f=readyFilm();const s=f.shots[0];let p=nextPromptVersion(f,s,buildShotPrompt(f,s,details));
  for(let i=0;i<15;i++){
    f.prompts.push(p);f=logFilmAttempt(f,p,{result:`raw-${i}.mp4`,changed:`Attempt ${i}`,verdict:'rejected'});
    if(i<14)p=nextPromptVersion(f,s,p.content.replace(/Room tone(?: \d+)?\./,`Room tone ${i+1}.`));
  }
  assert.throws(()=>nextPromptVersion(f,s,p.content.replace(/Room tone \d+\./,'Room tone final.')),/Fifteen/);
  s.goal='A simpler static establishing view';
  p=nextPromptVersion(f,s,buildShotPrompt(f,s,details));f.prompts.push(p);
  f=logFilmAttempt(f,p,{result:'simplified.mp4',changed:'Simplified shot goal',verdict:'rejected'});
  assert.equal(nextPromptVersion(f,s,p.content.replace('Room tone.','Quiet room tone.')).version,17);
});
test('storage isolates accounts, rejects malformed imports and reports write failures',()=>{
  const values={};const storage={getItem:k=>values[k]??null,setItem:(k,v)=>{values[k]=v;},removeItem:k=>{delete storage[k];delete values[k];}};
  const f=readyFilm();assert.equal(writeFilm(storage,'alice',f),true);assert.equal(readFilm(storage,'alice').film.name,f.name);assert.equal(readFilm(storage,'bob').film.name,'');
  assert.equal(writeFilm(storage,null,f),false);assert.throws(()=>writeFilm({setItem(){throw Error('full');}},'alice',f),/full/);
  assert.throws(()=>parseFilm('{broken'));assert.throws(()=>parseFilm(JSON.stringify({...f,shots:[null]})));assert.throws(()=>parseFilm('x'.repeat(1_000_001)));
  Object.assign(storage,values);clearFilmLocal(storage);assert.equal(readFilm(storage,'alice').film.name,'');
});
test('exports preserve the studio structure, all prompt versions and separate edit text',()=>{
  const f=readyFilm();f.shots[0].text='OPEN';f.shots[0].textPlacement='Top left';f.shots[0].textContext='Opening title';
  const files=studioFiles(f);assert.equal(files['AGENTS.md'],files['CLAUDE.md']);
  for(const p of ['assets/characters/','assets/locations/','assets/props/','prompts/','generations/','selects/','edit/','color/','sound/','master/','docs/'])assert.ok(p in files,p);
  assert.match(files['docs/text-tasks.md'],/OPEN/);assert.match(files['assets/locations/room-v1.md'],/Status: locked/);
  assert.equal(new DataView(studioZip(f).buffer).getUint32(0,true),0x04034b50);
});
