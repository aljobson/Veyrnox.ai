import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function hook(fetch) {
  const loaded={exports:{}};
  const source=readFileSync(new URL('../app/veyrnox/app/admin/_components/useAdminMutation.js',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','exports','navigator','crypto',compiled)(id=>{
    if(id==='react')return {useRef:v=>({current:v}),useState:v=>[v,()=>{}]};
    if(id.endsWith('/gateway'))return {gatewayFetch:fetch};
    if(id==='./AdminPanel')return {adminError:()=> 'Retry the request'};
    throw Error('unexpected dependency');
  },loaded.exports,{onLine:true},globalThis.crypto);
  return loaded.exports.useAdminMutation('/admin/switches',async()=>{});
}
test('uncertain saves reuse their key; confirmed saves end the intent and allow a fresh decision',async()=>{
  const keys=[];let fail=true;
  const mutation=hook(async(_path,options)=>{keys.push(options.headers['Idempotency-Key']);if(fail)throw {status:503};});
  const body={key:'generation',state:'off',reason:'Pause for maintenance'};
  await mutation.save(body);fail=false;await mutation.save(body);
  assert.equal(keys[0],keys[1],'lost response retries the original intent');
  await mutation.save(body);assert.notEqual(keys[1],keys[2],'later explicit decision is not replayed from an older successful save');
});
test('duplicate clicks during a pending mutation issue only one request',async()=>{
  let finish,calls=0;
  const mutation=hook(()=>{calls++;return new Promise(resolve=>finish=resolve);});
  const pending=mutation.save({reason:'Test'});await mutation.save({reason:'Test'});assert.equal(calls,1);
  finish();await pending;
});
test('dashboard expansion navigation only reads permissions and never submits a write',async()=>{
  const effects=[],calls=[],loaded={exports:{}};
  const source=readFileSync(new URL('../app/veyrnox/app/admin/_components/AdminExpansionLinks.js',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',code)(id=>{
    if(id==='react')return {useState:()=>[[],()=>{}],useEffect:fn=>effects.push(fn)};
    if(id==='react/jsx-runtime')return require(id);
    if(id==='next/link')return 'a';
    if(id.endsWith('/adminTabs'))return {ADMIN_TABS:[]};
    if(id.endsWith('/gateway'))return {gatewayFetch:async(...args)=>{calls.push(args);return {permissions:[]};}};
    throw Error('unexpected dependency '+id);
  },loaded.exports);
  loaded.exports.AdminExpansionLinks();
  const cleanups=effects.map(fn=>fn());await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[['/admin/permissions']]);
  for(const cleanup of cleanups)cleanup?.();
});
