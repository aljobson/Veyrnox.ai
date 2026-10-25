import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey, tOr } from '../lib/i18n/translate.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound8.mjs';
process.env.TZ='UTC';

test('round 8 completed files have zero unresolved literals and no translated machine values or translator shadowing',()=>{
 for(const file of Object.values(files)){
  const source=readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.deepEqual(candidates(file,source,{app:true}).filter(row=>row.status==='unresolved'),[],file);
  assert.deepEqual(tree.parseDiagnostics,[],file);
  function scan(node){
   if(ts.isArrowFunction(node)||ts.isFunctionExpression(node))assert.ok(!node.parameters.some(parameter=>parameter.name.getText(tree)==='t'),file);
   if(ts.isJsxAttribute(node)&&(['value','id','name'].includes(node.name.text)||node.name.text.startsWith('data-')))assert.doesNotMatch(node.getText(tree),/\bt(?:Or)?\(/,file);
   ts.forEachChild(node,scan);
  }scan(tree);
 }
});
test('round 8 English text and accessible labels stay byte-identical to main',async()=>{
 const baseline=JSON.parse(readFileSync('tests/fixtures/app-round8-english-main.json','utf8')),messages=await appMessagesFor('en');
 assert.equal(baseline.length,scenarios.length);
 for(const [index,scenario] of scenarios.entries()){
  const html=renderScenario(scenario,'en',messages);
  assert.equal(visibleText(html),baseline[index].text,`${index} ${scenario.area}`);
  assert.deepEqual([...html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map(match=>match[0]),baseline[index].labels,`${index} ${scenario.area} accessible copy`);
 }
});
for(const locale of ['de','ja','ar'])test(`round 8 real ${locale} component renders have no raw keys or missing placeholders`,async()=>{
 const messages=await appMessagesFor(locale);
 for(const [index,scenario] of scenarios.entries()){
  const html=renderScenario(scenario,locale,messages);
  assert.doesNotMatch(html,/app\.(?:library|editor|film|chat|explore)\.[A-Za-z]|\{(?:name|count|kind|frame|n|max|planned|target|score|total|label|color|query|time)\}/,`${index} ${scenario.area}`);
 }
});
test('round 8 policy facts match main and keep their numbers in all eleven languages',async()=>{
 const baseline=JSON.parse(readFileSync('tests/fixtures/app-round8-policy-main.json','utf8')),en=await appMessagesFor('en');
 const numbers=value=>(value.match(/\d+(?:[.,]\d+)*/g)||[]).sort();
 assert.ok(Object.keys(baseline).length>=10);
 for(const {code} of LOCALES){const messages=await appMessagesFor(code);for(const [key,value] of Object.entries(baseline)){assert.equal(en[key],value,key);assert.deepEqual(numbers(messages[key]),numbers(value),`${code}/${key}`);}}
});
test('round 8 plural families and non-English numeric labels use Intl without changing English grammar',async()=>{
 for(const {code} of LOCALES){const messages=await appMessagesFor(code),t=translator(code,messages);
  for(const family of ['app.film.tests.passed','app.editor.bin.files']){
   for(const form of ['zero','one','two','few','many','other'])assert.ok(messages[`${family}.${form}`]);
   for(const count of [0,1,2,3,11,21,102])assert.ok(messages[pluralKey(t,code,family,count)]);
  }
 }
 for(const locale of ['de','ja','ar']){
  const messages=await appMessagesFor(locale),html=renderScenario(scenarios.find(row=>row.area==='device'&&row.states?.[0].length),locale,messages);
  assert.ok(html.includes(new Intl.NumberFormat(localeTag(locale),{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2}).format(12345678/1048576)),locale);
 }
 for(const englishDefault of [undefined,'en-US','en-GB',[]])assert.equal(localeTag('en',englishDefault),englishDefault);
});
test('unknown source labels and option names keep safe fallback text without leaking lookup keys',async()=>{
 for(const locale of ['de','ja','ar']){
  const messages=await appMessagesFor(locale),t=translator(locale,messages);
  assert.equal(tOr(t,'app.film.verdict.future',t('app.publish.contacts.unknown')),messages['app.publish.contacts.unknown']);
  const scenario=scenarios.find(row=>row.area==='filmTests'),film=structuredClone(scenario.props.film);
  film.assets[0].tests['view-0']={verdict:'future_verdict',result:'User output'};
  const verdictHtml=renderScenario({...scenario,props:{...scenario.props,film}},locale,messages);
  assert.doesNotMatch(verdictHtml,/future_verdict/);assert.ok(verdictHtml.includes(messages['app.publish.contacts.unknown']));
  const f=fixture(locale,'/app/film-studio',{messages,expose:{[files.master]:['masterError']}}),errorText=f.load(files.master).masterError;
  for(const error of [{code:'future_error',message:'future_error'},{message:'source_not_found'},{}])assert.equal(errorText(t,error),messages['app.film.master.failed']);
  assert.equal(errorText(t,{message:'Local helper message unchanged.'}),'Local helper message unchanged.');
  assert.match(renderScenario(scenarios.find(row=>row.area==='sources'&&row.props.model.media.image.label),locale,messages),/Provider label unchanged/);
  const html=renderScenario(scenarios.find(row=>row.area==='fields'),locale,messages);
  assert.match(html,/value="source-over"/);assert.match(html,/value="none"/);assert.match(html,/User option/);
 }
});
test('canvas geometry and transport retain LTR coordinates while localized controls use logical placement and stable selectors',()=>{
 const canvas=readFileSync(files.handles,'utf8'),transport=readFileSync(files.transport,'utf8');
 assert.match(canvas,/dir="ltr"/);assert.match(canvas,/insetInlineStart/);assert.doesNotMatch(canvas,/style=\{\{ left:|-right-/);
 assert.match(transport,/dir="ltr"/);assert.doesNotMatch(transport,/ml-auto/);
 const spec=readFileSync('e2e/authenticated-media.spec.mjs','utf8');
 for(const hook of ['film-open-in-studio','generated-result-image'])assert.ok(spec.includes(`getByTestId('${hook}')`));
 assert.match(spec,/film-download-project'\)\)\.toHaveCount\(0\)/);
 assert.doesNotMatch(spec,/film-(?:import|export)-json|Import studio JSON/);
});
