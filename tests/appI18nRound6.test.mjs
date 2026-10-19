import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound6.mjs';
process.env.TZ='UTC';

test('round 6 finishes twelve files without unresolved literals, syntax errors, translated machine values or translator shadowing',()=>{
 for(const file of Object.values(files)){
  const source=readFileSync(file,'utf8'), tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.deepEqual(candidates(file,source,{app:true}).filter(row=>row.status==='unresolved'),[],file);
  assert.deepEqual(tree.parseDiagnostics,[],file);
  function scan(node){
   if(ts.isArrowFunction(node)||ts.isFunctionExpression(node))assert.ok(!node.parameters.some(parameter=>parameter.name.getText(tree)==='t'),file);
   if(ts.isJsxAttribute(node)&&(['value','id','key','name'].includes(node.name.text)||node.name.text.startsWith('data-')))assert.doesNotMatch(node.getText(tree),/\bt(?:Or)?\(/,file);
   ts.forEachChild(node,scan);
  }scan(tree);
 }
});
test('26 English component states remain byte-identical to main',async()=>{
 const baseline=JSON.parse(readFileSync('tests/fixtures/app-round6-english-main.json','utf8')), messages=await appMessagesFor('en');
 assert.equal(baseline.length,scenarios.length);
 for(const [index,scenario] of scenarios.entries()){
  const html=renderScenario(scenario,'en',messages);
  assert.equal(visibleText(html),baseline[index].text,`${index} ${scenario.area}`);
  assert.deepEqual([...html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map(match=>match[0]),baseline[index].labels,`${index} ${scenario.area} accessible copy`);
 }
});
for(const locale of ['de','ja','ar'])test(`round 6 renders 26 real ${locale} component states without raw keys`,async()=>{
 const messages=await appMessagesFor(locale);
 for(const [index,scenario] of scenarios.entries()){
  const html=renderScenario(scenario,locale,messages);
  assert.doesNotMatch(html,/app\.(?:account|editor|publish|credits|film)\.[A-Za-z]|\{(?:count|name|width|height|number|seconds|rate|date|format|quality|channel)\}/,`${index} ${scenario.area}`);
  if(scenario.area==='tracks'){assert.match(html,/User track unchanged/);assert.match(html,/User caption unchanged/);assert.match(html,/dir="ltr"/);}
  if(scenario.area==='agent')assert.match(html,/<ul lang="en" dir="ltr"/);
  if(scenario.area==='schedule')assert.match(html,/value="weekly"|value="monthly"/);
  if(scenario.area==='font')assert.match(html,/User licence unchanged/);
  if(scenario.area==='saved'&&scenario.name==='RenderCard')assert.match(html,/User video unchanged/);
 }
});
test('round 6 policy numbers and exact English statements match main',async()=>{
 const baseline=JSON.parse(readFileSync('tests/fixtures/app-round6-policy-main.json','utf8')), en=await appMessagesFor('en');
 const numbers=text=>(text.match(/\d+(?:[.,]\d+)*/g)||[]).sort();
 assert.ok(Object.keys(baseline).length>=9);
 for(const {code} of LOCALES){const messages=await appMessagesFor(code);for(const [key,value] of Object.entries(baseline)){
  assert.equal(en[key],value,key);assert.deepEqual(numbers(messages[key]),numbers(value),`${code}/${key}`);
 }}
});
test('four round 6 count families include all plural forms; English Intl defaults remain exact',async()=>{
 for(const {code} of LOCALES){const messages=await appMessagesFor(code),t=translator(code,messages);
  for(const family of ['app.editor.agent.apply','app.editor.agent.skipped','app.publish.contactImport.imported','app.film.setup.seconds']){
   for(const form of ['zero','one','two','few','many','other'])assert.ok(messages[`${family}.${form}`],`${code}/${family}/${form}`);
   for(const count of [0,1,2,3,11,21,102])assert.ok(messages[pluralKey(t,code,family,count)]);
  }
 }
 for(const original of [undefined,'en-US','en-GB',[]])assert.equal(localeTag('en',original),original);
});
test('SVG and parser-command audit exceptions cannot hide arbitrary UI copy',()=>{
 const source=readFileSync(files.tracks,'utf8');
 assert.ok(candidates(files.tracks,source.replace("lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z'","lock:'Untranslated label'"),{app:true}).some(row=>row.status==='unresolved'));
 const commands=candidates(files.agent,readFileSync(files.agent,'utf8'),{app:true}).filter(row=>row.status==='allowlisted');
 assert.equal(commands.length,4);
 assert.ok(commands.every(row=>row.reason.includes('English-only local parser')));
 assert.equal(candidates(files.agent,'<p>Untranslated label</p>',{app:true})[0].status,'unresolved');
});
test('unknown server sanction actions retain a safe display fallback',async()=>{
 const scenario={...scenarios[4],props:{...scenarios[4].props,sanction:{...scenarios[4].props.sanction,action:'Future action'}}};
 for(const locale of ['en','de','ja','ar']){const html=renderScenario(scenario,locale,await appMessagesFor(locale));assert.match(html,/Future action/);assert.doesNotMatch(html,/app\.account\.appeals\.action/);}
});
