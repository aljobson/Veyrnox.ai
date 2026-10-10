import test from 'node:test';
import assert from 'node:assert/strict';
import { filmMasterPlan } from '../app/veyrnox/_lib/filmMaster.mjs';
import { paintFrame } from '../app/veyrnox/_lib/editorRender.mjs';
import { ACCEPTANCE_CHECKS, STYLE_BOARDS, PROMPT_DETAILS, testMatrix, lockAsset, buildShotPrompt, nextPromptVersion, logFilmAttempt } from '../app/veyrnox/_lib/filmStudio.js';
import { filmFixture } from './fixtures/filmStudio.mjs';

function acceptedFilm() {
  let film=filmFixture();
  film.boards=[{id:'room',name:'@room:v1',type:'location',decision:'approved',references:Array.from({length:8},(_,i)=>({source:`room-${i}.png`,caption:`Room view ${i}`,kind:'reference'}))},...STYLE_BOARDS.map(name=>({id:name,name,type:'style',decision:'approved',references:[{source:`${name}.png`,caption:name,kind:'reference'}]}))];
  film.assets=[{tag:'@room',version:1,type:'location',descriptor:'Cream walls and oak floor, white window.',references:['room.png'],tests:{},lock:null}];
  film.assets[0].tests=Object.fromEntries(testMatrix(film,film.assets[0]).map(row=>[row.id,{result:`${row.id}.png`,verdict:'pass'}]));
  film=lockAsset(film,'@room:v1');
  const content=buildShotPrompt(film,film.shots[0],Object.fromEntries(PROMPT_DETAILS.map(([key])=>[key,'Complete direction.'])));
  const prompt=nextPromptVersion(film,film.shots[0],content);film.prompts.push(prompt);
  return logFilmAttempt(film,prompt,{result:'take.mp4',changed:'First take',verdict:'accepted',checks:ACCEPTANCE_CHECKS});
}
const wide={kind:'video',seconds:10.041667,width:1928,height:1072,canDecodeVideo:true,hasAudio:false};

test('an off-ratio delivered take gets an exact 1920x1080 ten-second master plan',()=>{
  const film=acceptedFilm(),plan=filmMasterPlan(film,film.attempts[0],wide);
  assert.deepEqual(plan.size,{width:1920,height:1080});
  assert.equal(plan.size.width*9,plan.size.height*16);
  assert.equal(plan.timeline.aspect,'16:9');assert.equal(plan.timeline.video[0].len,300);
  assert.equal(plan.timeline.media['film-take'].width,1928);
  assert.equal(plan.seconds,10);assert.equal(plan.filename,'sc01-sh01-v1-16x9-master.mp4');
});
test('short, unreadable and non-video sources cannot produce a master',()=>{
  const f=acceptedFilm(),a=f.attempts[0];
  assert.throws(()=>filmMasterPlan(f,a,{...wide,seconds:9.9}),/shorter/);
  assert.throws(()=>filmMasterPlan(f,a,{...wide,canDecodeVideo:false}),/decode/);
  assert.throws(()=>filmMasterPlan(f,a,{...wide,kind:'image'}),/video for this take/);
});
test('rejected, foreign and stale takes cannot produce a current master',()=>{
  const f=acceptedFilm(),a=f.attempts[0];
  assert.throws(()=>filmMasterPlan(f,{...a},wide),/accepted take/);
  a.verdict='rejected';assert.throws(()=>filmMasterPlan(f,a,wide),/accepted take/);a.verdict='accepted';
  f.assets[0].descriptor+=' Changed';assert.throws(()=>filmMasterPlan(f,a,wide),/current locked film/);
});
test('a different film aspect is refused instead of silently changing it',()=>{
  const f=acceptedFilm();f.stack.aspect='9:16';assert.throws(()=>filmMasterPlan(f,f.attempts[0],wide),/16:9 film/);
});
test('cover fills and centre-crops without stretching; existing default fitting stays contained',()=>{
  const pic={width:1928,height:1072},layers={base:{k:0,time:0},over:null,texts:[]},rects=[];
  const g={fillRect(){},drawImage(_pic,...rect){rects.push(rect)}};
  paintFrame(g,1920,1080,layers,{base:pic,over:null});
  const contain=rects.pop();assert.equal(contain[0],0);assert(contain[1]>0);assert.equal(contain[2],1920);
  paintFrame(g,1920,1080,layers,{base:pic,over:null},'cover');
  const cover=rects.pop();assert(cover[0]<0);assert.equal(cover[1],0);assert.equal(cover[3],1080);
  assert(Math.abs(cover[2]/cover[3]-pic.width/pic.height)<1e-10);
});
