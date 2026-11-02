import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),jsx=require('react/jsx-runtime');
const copy=(await import('../lib/i18n/messages/app/en/credits-subscription.mjs')).default;
const hooks={useState:v=>[v,()=>{}],useRef:v=>({current:v}),useCallback:v=>v,useEffect(){}};
const compile=(file,dependency)=>{const m={exports:{}};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(dependency,m.exports);return m.exports;};
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];if(typeof tree.type==='function')return nodes(tree.type(tree.props));return[tree,...nodes(tree.props?.children)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(typeof tree==='string')return tree;if(tree&&typeof tree==='object')return text(tree.props?.children);return'';}
const panel=compile('app/veyrnox/app/admin/_components/AdminPanel.js',id=>id==='react'?hooks:id==='react/jsx-runtime'?jsx:{});
function render(name,data,offline=false){
 const page=compile('app/veyrnox/app/admin/'+name+'/page.js',id=>{
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return jsx;
  if(id.endsWith('NavBar'))return{AppNav:()=>jsx.jsx('header',{})};if(id.endsWith('/Main'))return{Main:({children})=>jsx.jsx('main',{children})};
  if(id.endsWith('AdminPanel'))return{...panel,AdminPanel:({children})=>children(data,()=>{},offline)};
  if(id.endsWith('useAdminMutation'))return{useAdminMutation:()=>({save(){},pending:false,error:'',message:''})};
  if(id.endsWith('credits-subscription.mjs'))return{default:copy};throw Error(id);
 });return nodes(page.default());
}
test('new admin pages render exactly one main and readable empty states',()=>{
 for(const [name,data,label]of [
  ['plans',{permissions:['plans.read'],plans:[],packs:[],history:[]},'Subscription plans'],
  ['traffic',{telemetry:false,days:[],paths:[],countries:[],devices:[],referrers:[]},'Telemetry off'],
  ['support',{permissions:['support'],tickets:[],intake:false,next:null},'No tickets'],
 ]){const n=render(name,data);assert.equal(n.filter(x=>x.type==='main').length,1);assert.ok(n.some(x=>text(x).includes(label)));}
});
test('finance sees no availability controls; owner writes are disabled offline and retired rows are not options',()=>{
 const data={plans:[],packs:[{id:'web-209',editable:true},{id:'web-100',editable:false}],history:[],permissions:['plans.read']};
 assert.equal(render('plans',data).filter(n=>n.type==='form').length,0);
 const owner=render('plans',{...data,permissions:['plans.read','plans.write']},true);
 assert.equal(owner.filter(n=>n.type==='form').length,1);
 assert.ok(!owner.some(n=>n.type==='option'&&text(n)==='web-100'));
 assert.ok(owner.some(n=>n.type==='button'&&text(n)==='Save pack availability'&&n.props.disabled));
});
