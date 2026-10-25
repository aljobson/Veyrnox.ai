import test from 'node:test';
import assert from 'node:assert/strict';
import * as cloud from '../app/veyrnox/_lib/filmStudioCloud.js';
import { emptyFilm, lockAsset, isLocked, testMatrix, STYLE_BOARDS, buildShotPrompt, nextPromptVersion, promptContext } from '../app/veyrnox/_lib/filmStudio.js';
import { parseFilm, writeWorkspace, clearFilmLocal } from '../app/veyrnox/_lib/filmStudioStorage.js';
import { filmFixture } from './fixtures/filmStudio.mjs';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const project = (id = a, revision = 1, updated_at = '2026-10-22T12:00:00Z') => ({ id, revision, name: 'Film', shot_count: 1, created_at: '2026-10-21T12:00:00Z', updated_at });
const link = (id = a) => ({ userId: 'alice', id, revision: 1, savedText: JSON.stringify(emptyFilm()) });
const state = () => ({ film: emptyFilm(), cloud: link(), userId: 'alice', stage: 0, generation: 3, ready: true, saved: true, error: null, pending: null });
const request = s => cloud.saveRequest({ ...s, sessionUserId: 'alice' });
const storage = () => { const data = {}; Object.defineProperties(data, { setItem: { value: (k,v) => { data[k]=v; } }, getItem: { value: k => data[k] || null }, removeItem: { value: k => delete data[k] } }); return data; };
test('POST and PUT contain only exact snapshot text and validated ownership/revision', () => {
  const s = state(), text = JSON.stringify(s.film);
  assert.deepEqual(request({ ...s, cloud: null }), { method: 'POST', path: '/film-studio', body: { studio_json: text } });
  assert.deepEqual(request(s), { method: 'PUT', path: '/film-studio/' + a, body: { expected_revision: 1, studio_json: text } });
  for (const patch of [{ userId: null }, { sessionUserId: 'bob' }, { cloud: { ...link(), userId: 'bob' } }, { cloud: { ...link(), revision: 0 } }]) assert.equal(cloud.saveRequest({ ...s, sessionUserId: 'alice', ...patch }), null);
  assert.equal(request({ ...s, film: { ...s.film, script: '🙂'.repeat(250001) } }), null);
});
test('Open B replaces live A and remounts same-id editors; edits save only B', () => {
  const s = state(), filmB = { ...parseFilm(JSON.stringify(filmFixture())), name: 'B' };
  s.film = { ...filmB, name: 'A' }; s.pending = { userId: 'alice', generation: 3, starter: {} };
  const next = { ...s, ...cloud.replaceWorkspaceFilm(s, filmB, link(b)) };
  assert.equal(next.film, filmB); assert.equal(next.cloud.id, b); assert.equal(next.generation, 4); assert.equal(next.pending, null);
  next.film = { ...next.film, name: 'Edited B' };
  assert.equal(request(next).path, '/film-studio/' + b); assert.equal(JSON.parse(request(next).body.studio_json).name, 'Edited B');
  assert.equal(request(next).body.expected_revision, 1);
  for (const replacement of [emptyFilm(), filmB]) assert.equal(cloud.replaceWorkspaceFilm(next, replacement, null).cloud, null);
});
test('late save after replacement/account change is discarded; ordinary edits retain submitted snapshot', () => {
  const s = state(), captured = { userId: 'alice', generation: 3, text: JSON.stringify(s.film) };
  const replaced = { ...s, ...cloud.replaceWorkspaceFilm(s, { ...emptyFilm(), name: 'B' }, null) };
  assert.equal(cloud.acceptSaveResult(replaced, captured, project()), null); assert.equal(request(replaced).method, 'POST');
  assert.equal(cloud.acceptSaveResult({ ...s, userId: 'bob' }, captured, project()), null);
  const edited = { ...s, film: { ...s.film, name: 'edit during save' } };
  const patch = cloud.acceptSaveResult(edited, captured, project(a, 2));
  assert.deepEqual(Object.keys(patch), ['cloud']); assert.equal(patch.cloud.savedText, captured.text);
  assert.equal(cloud.isNewerThanSaved(edited.film, patch.cloud), true); assert.equal(edited.generation, 3);
});
test('remove uses selected list row even unlinked, rejects stale membership/account/revision', () => {
  const row = project(b, 2), list = { userId: 'alice', rows: [project(), row] };
  assert.deepEqual(cloud.removeRequest(list, row, 'alice'), { method: 'DELETE', path: '/film-studio/' + b, body: { expected_revision: 2 } });
  for (const [l,r,u] of [[list,row,'bob'],[list,project(b,1),'alice'],[{userId:'alice',rows:[]},row,'alice'],[null,row,'alice']]) assert.equal(cloud.removeRequest(l,r,u), null);
  const s = state(); assert.equal(cloud.unlinkPatch(s,b), null);
  assert.deepEqual(cloud.unlinkPatch(s,a), { cloud: null });
  const edited = { ...s, film: { ...s.film, name: 'edit during DELETE' }, stage: 0 };
  const unlinked = { ...edited, ...cloud.unlinkPatch(edited,a) };
  assert.equal(unlinked.film.name, 'edit during DELETE'); assert.equal(unlinked.stage, 0); assert.equal(unlinked.generation, 3);
  assert.equal(request(unlinked).method, 'POST'); assert.ok(cloud.removeRequest(list,row,'alice'));
  assert.equal(request({ ...s, ...cloud.unlinkPatch(s,a) }).method, 'POST', 'PUT 404 uses the same unlink patch');
});
test('save metadata is merged immediately so remove always uses latest revision', () => {
  let list = { userId: 'alice', rows: [] };
  list = cloud.mergeSavedProject(list, { ...project(), idempotent: true }, 'alice');
  assert.equal(cloud.removeRequest(list,list.rows[0],'alice').body.expected_revision, 1);
  list = cloud.mergeSavedProject(list, project(b,1,'2026-10-22T13:00:00Z'), 'alice');
  list = cloud.mergeSavedProject(list, project(a,2,'2026-10-22T14:00:00Z'), 'alice');
  assert.equal(list.rows[0].id, a); assert.equal(cloud.removeRequest(list,list.rows[0],'alice').body.expected_revision, 2);
  assert.equal('idempotent' in list.rows[0], false); assert.equal(cloud.mergeSavedProject(list,project(),'bob'), list);
});
test('first load restores the atomic pair with unknown saved text; refresh preserves all live state', () => {
  const store = storage(), tab1 = state(), filmB = { ...emptyFilm(), name: 'B' };
  writeWorkspace(store,'alice',filmB,link(b));
  assert.deepEqual(cloud.sessionLoadPatch(store,'alice',tab1), {});
  assert.equal(request(tab1).path, '/film-studio/' + a); assert.equal(JSON.parse(request(tab1).body.studio_json).name, '');
  const loaded = cloud.sessionLoadPatch(store,'alice',{ ...tab1, ready:false });
  assert.equal(loaded.cloud.id,b); assert.equal(loaded.film.name,'B'); assert.equal(loaded.generation,4);
  assert.equal(cloud.isNewerThanSaved(loaded.film, loaded.cloud), true);
  const captured = { userId:'alice', generation:3, text:JSON.stringify(tab1.film) };
  assert.equal(cloud.acceptSaveResult({ ...tab1,...cloud.sessionLoadPatch(store,'alice',tab1) },captured,project(a,2)).cloud.revision,2);
  assert.equal(cloud.sessionLoadPatch(store,'alice',tab1,false).film.name,'B', 'flag-off forced reload remains');
});
test('unmounted sign-out then sign-in and account switches invalidate links/pending/generation', () => {
  const s = state(); s.pending={userId:'alice',generation:3,starter:{}};
  assert.equal(cloud.boundaryPatch(s,'alice'),null);
  let next={...s,...cloud.boundaryPatch(s,null)}; next={...next,...cloud.boundaryPatch(next,'alice')};
  assert.equal(next.generation,5); assert.equal(next.cloud,null); assert.equal(next.pending,null); assert.equal(next.ready,false);
  const store=storage(); writeWorkspace(store,'alice',s.film,s.cloud); clearFilmLocal(store);
  assert.equal(cloud.sessionLoadPatch(store,'alice',next).cloud,null);
  assert.equal(cloud.sessionLoadPatch(store,'bob',s).cloud,null);
  assert.equal(cloud.pendingVisible({...s,userId:'bob'}),false);
  assert.equal(cloud.pendingVisible({...s,...cloud.sessionLoadPatch(store,'alice',s)}),true);
});
test('write failure after server save drops the link without exposing removed export controls', () => {
  const s=state(), captured={userId:'alice',generation:3,text:JSON.stringify(s.film)};
  const saved={...s,...cloud.acceptSaveResult(s,captured,project())};
  const failed={...saved,...cloud.persistenceFailurePatch()};
  assert.equal(failed.cloud,null); assert.equal(failed.saved,false);
  assert.deepEqual(cloud.saveFailureKeys(failed,{status:503}),['app.film.cloud.failed']);
  assert.deepEqual(cloud.saveFailureKeys(s,{status:503}),['app.film.cloud.failed']);
});
test('list parsing drops invalid rows and projects extra fields away; handoff only selects known uuid', () => {
  const row=project();
  for (const bad of [null,{},[],{projects:{}}]) assert.equal(cloud.parseSavedFilms(bad),null);
  const rows=cloud.parseSavedFilms({projects:[{...row,secret:'drop'}, {...row,id:'bad'}, {...row,id:b,shot_count:201}, {...row,id:b,revision:0}, {...row,id:b,updated_at:'yesterday'}]});
  assert.deepEqual(rows,[row]); assert.equal(cloud.parseCloudParam('?cloud='+a,rows),rows[0]);
  for(const search of ['?cloud=bad','?cloud='+b,'']) assert.equal(cloud.parseCloudParam(search,rows),null);
  assert.equal(cloud.openPath('../bad'),null);
});
test('error mapping exposes keys only', () => {
  for(const err of [{status:404,code:'NOT_FOUND'},{status:403,code:'FORBIDDEN'},{status:429},{status:429,code:'limit_reached'},{status:409,code:'CONFLICT'},{status:503,code:'DATA_UNAVAILABLE'},{message:'secret'}]) assert.match(cloud.cloudErrorKey(err),/^app\.film\.cloud\.[A-Za-z]+$/);
});
test('locked asset and current prompt survive exact POST/GET text', () => {
  let film=parseFilm(JSON.stringify(filmFixture()));
  film.boards=[{id:'room',name:'@room:v1',type:'location',decision:'approved',references:Array.from({length:8},(_,i)=>({source:`room-${i}.png`,caption:`view ${i}`,kind:'reference'}))},...STYLE_BOARDS.map(name=>({id:name,name,type:'style',decision:'approved',references:[{source:`${name}.png`,caption:name,kind:'reference'}]}))];
  const asset={tag:'@room',version:1,type:'location',descriptor:'Cream room with a west window.',references:['room.png'],tests:{},lock:null}; film.assets=[asset];
  asset.tests=Object.fromEntries(testMatrix(film,asset).map(r=>[r.id,{result:r.id+'.png',verdict:'pass'}])); film=lockAsset(film,'@room:v1');
  const details={map:'Window ahead.',camera:'Tripod.',timing:'Ten seconds.',physics:'Stationary.',lighting:'Warm.',audio:'Room tone.',palette:'Cream.',quality:'Stable.',constraints:'No changes.'};
  film.prompts=[nextPromptVersion(film,film.shots[0],buildShotPrompt(film,film.shots[0],details))];
  const post=request({...state(),film,cloud:null}); const body={studio_json:post.body.studio_json}; const opened=parseFilm(body.studio_json);
  assert.equal(body.studio_json,JSON.stringify(film)); assert.equal(JSON.stringify(opened),JSON.stringify(film));
  assert.equal(isLocked(opened,opened.assets[0]),true); assert.equal(opened.prompts[0].context,promptContext(opened,opened.shots[0]));
});
