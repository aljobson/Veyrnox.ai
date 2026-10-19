import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound7.mjs';
process.env.TZ='UTC';

test('round 7 finishes thirty files without unresolved literals, syntax errors, translated machine values or translator shadowing',()=>{
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
test('56 English component states remain byte-identical to main',async()=>{
 const baseline=JSON.parse(readFileSync('tests/fixtures/app-round7-english-main.json','utf8')), messages=await appMessagesFor('en');
 assert.equal(baseline.length,scenarios.length);
 for(const [index,scenario] of scenarios.entries()){
  const html=renderScenario(scenario,'en',messages);
  assert.equal(visibleText(html),baseline[index].text,`${index} ${scenario.area}`);
  assert.deepEqual([...html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map(match=>match[0]),baseline[index].labels,`${index} ${scenario.area} accessible copy`);
 }
});
for(const locale of ['de','ja','ar'])test(`round 7 renders 56 real ${locale} component states without raw keys`,async()=>{
 const messages=await appMessagesFor(locale);
 for(const [index,scenario] of scenarios.entries()){
  const html=renderScenario(scenario,locale,messages);
  assert.doesNotMatch(html,/app\.(?:account|editor|publish|credits|film)\.[A-Za-z]|\{(?:count|name|width|height|number|seconds|rate|date|format|quality|channel)\}/,`${index} ${scenario.area}`);

 }
});
test('round 7 policy numbers survive all eleven catalogs and English matches main',async()=>{
 const baseline=JSON.parse(readFileSync('tests/fixtures/app-round7-policy-main.json','utf8')),en=await appMessagesFor('en');
 const numbers=value=>(value.match(/\d+(?:[.,]\d+)*/g)||[]).sort();
 assert.equal(Object.keys(baseline).length,25);
 for(const {code} of LOCALES){const messages=await appMessagesFor(code);for(const [key,value] of Object.entries(baseline)){assert.equal(en[key],value,key);assert.deepEqual(numbers(messages[key]),numbers(value),`${code}/${key}`);}}
});
test('round 7 count families use plural rules with every Arabic and Russian form',async()=>{
 const families=['app.editor.original.count','app.editor.scenes.add','app.editor.finder.add','app.editor.filters.multiple','app.editor.credits.amount','app.editor.credits.buy','app.account.delete.lose','app.editor.review.showing','app.editor.filters.selected','app.film.masters.bytes','app.editor.review.missing','app.oddlings.catalog.chosen','app.chat.attach.limit','app.editor.lyrics.available'];
 for(const {code} of LOCALES){const messages=await appMessagesFor(code),t=translator(code,messages);
  for(const family of families){for(const form of ['zero','one','two','few','many','other'])assert.ok(messages[`${family}.${form}`],`${code}/${family}/${form}`);for(const count of [0,1,2,3,11,21,102])assert.ok(messages[pluralKey(t,code,family,count)]);}
 }
});
test('unknown server values retain safe fallbacks; known blockers translate and raw codes never render',async()=>{
 for(const locale of ['de','ja','ar']){
  const messages=await appMessagesFor(locale),html=renderScenario(scenarios[2],locale,messages);
  assert.doesNotMatch(html,/future_code|active_subscription|projects_present|app\.account\.delete\.blocker/);
  assert.ok(visibleText(html).includes(messages['app.account.delete.blocker.projects_present']));
  const f=fixture(locale,'/app/editor',{messages,expose:{[files.brandAssets]:['assetError']}});
  const errorText=f.load(files.brandAssets).assetError(translator(locale,messages),{code:'future_api_code',message:'future_api_code'});
  assert.equal(errorText,messages['app.editor.brandAssets.failed']);
  const source=renderScenario({area:'sources',name:'SourcePickers',props:{media:{image:{label:'Provider label unchanged'}},sources:{},onPick(){}}},locale,messages);
  assert.match(source,/Provider label unchanged/);
 }
});
test('non-English time labels use the mapped Intl locale; English defaults remain unchanged',async()=>{
 for(const locale of ['de','ja','ar']){
  const messages=await appMessagesFor(locale),number=value=>new Intl.NumberFormat(localeTag(locale),{useGrouping:false,minimumIntegerDigits:value.length}).format(Number(value));
  const time=[number('0'),':',number('01'),'.',number('0')].join('');
  assert.ok(renderScenario(scenarios[15],locale,messages).includes(time),locale);
 }
 for(const original of [undefined,'en-US','en-GB',[]])assert.equal(localeTag('en',original),original);
});
test('SVG geometry exemption cannot hide tool-rail copy and E2E uses stable hooks',()=>{
 const source=readFileSync(files.rail,'utf8');
 assert.ok(candidates(files.rail,source.replace("Media:'M3 6h7l2 2h9v12H3zM7 13h10M7 17h7'","Media:'Untranslated label'"),{app:true}).some(row=>row.status==='unresolved'));
 assert.match(readFileSync('e2e/authenticated-shared-links.spec.mjs','utf8'),/getByTestId\('review-comment'\)/);
 assert.match(readFileSync('e2e/authenticated-project-editor.spec.mjs','utf8'),/getByTestId\('editor-tool-Audio'\)/);
 assert.doesNotMatch(readFileSync('e2e/authenticated-shared-links.spec.mjs','utf8'),/getByRole\('textbox', \{ name: 'Review comment'/);
});
