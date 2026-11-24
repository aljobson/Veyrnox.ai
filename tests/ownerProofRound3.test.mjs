import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';
import { ownerProofExposure, hasOwnerProofExposure } from '../lib/ownerProofOverlay.mjs';
const phone=readFileSync('apps/mobile/src/app/(app)/create/[modelId].tsx','utf8');
// The owner-proof logic lives in the phone hook; the screen keeps the submit guard and the disabled state.
const phoneHook=readFileSync('apps/mobile/src/lib/useOwnerProofCreate.ts','utf8');
const ast=ts.createSourceFile('phone.tsx',phone,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hookAst=ts.createSourceFile('hook.ts',phoneHook,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function fragment(name, fn=false, tree=ast) {
    let code;
    function visit(node){if(fn&&ts.isFunctionDeclaration(node)&&node.name?.text===name)code=node.getText(tree);if(!fn&&ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)code=`const ${node.getText(tree)};`;ts.forEachChild(node,visit);}visit(tree);assert.ok(code,name);return code;
}
const declarations=[...['privateImage','exposed','exposedHere','media','withdrawn','unsupportedProofSource','removeProofImage'].map(name=>fragment(name,false,hookAst)),fragment('disabled')].join('\n');
const code=ts.transpileModule(`${declarations}\n${fragment('generate',true)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function evaluate(context) { return new Function('context',`with(context){${code};return {exposed,unsupportedProofSource,disabled,removeProofImage,generate};}`)(context); }
for(const entry of ['references','startFile']) test(`phone ${entry}: private withdrawal disables and refuses submission, removal restores readiness`,async()=>{
    const id='veo-3.1-lite-kie';let requests=0;
    const publicModel={id,capabilities:{media:{}}},privateModel={...publicModel,capabilities:{media:{image:{maxFiles:1}}}};
    const context={publicModel,model:privateModel,privateModels:[privateModel],swapScene:null,proofExposure:null,accountEpoch:1,
        references:entry==='references'?[{slot:'image',origin:'asset',asset_id:'owned'}]:[],startFile:entry==='startFile'?{uri:'picked.png'}:null,
        ownerProofExposure,hasOwnerProofExposure,busy:false,waiting:false,inProgress:false,complete:false,freeLoading:false,ready:true,matchingRetry:{},missing:0,
        pending:{current:{run:()=>{requests++;}}},setReferences:fn=>{context.references=fn(context.references);},setStartFile:value=>{context.startFile=value;},setError:()=>{}};context.input=context;
    let view=evaluate(context);context.proofExposure=view.exposed;assert.equal(view.disabled,false);
    context.privateModels=[];context.model=publicModel;
    view=evaluate(context);assert.equal(view.disabled,true);assert.equal(view.unsupportedProofSource,true);
    await view.generate();assert.equal(requests,0);
    view.removeProofImage();view=evaluate(context);assert.equal(view.disabled,false);assert.equal(view.unsupportedProofSource,false);
    assert.deepEqual(context.references,[]);assert.equal(context.startFile,null);
});
test('phone public flow and swap scenes have no withdrawal guard without private exposure',()=>{
    for(const swapScene of [null,{people:1}]) {
        const model={id:'public',capabilities:{media:{}}};
        const context={publicModel:model,model,privateModels:[],swapScene,proofExposure:null,accountEpoch:1,references:[{slot:'image'}],startFile:null,
            ownerProofExposure,hasOwnerProofExposure,busy:false,waiting:false,inProgress:false,complete:false,freeLoading:false,ready:true,matchingRetry:null,missing:0};
        const view=evaluate(context);assert.equal(view.unsupportedProofSource,false);assert.equal(view.disabled,false);
    }
    assert.match(phone,/unsupportedProofSource \? <View><Text[^\n]+form.err.sourceMismatch/);
    assert.match(phone,/label=\{t\('chat.attach.removeN', \{ n: 1 \}\)\} onPress=\{removeProofImage\}/);
});
test('0607 requires both 0604 schema markers before the telemetry wrapper changes',()=>{
    const sql=readFileSync('packages/db/schema/supabase/0607_owner_proof_telemetry.sql','utf8');
    assert.equal(existsSync('packages/db/schema/supabase/0601_owner_proof_telemetry.sql'),false);
    const first=sql.match(/DO \$\$[\s\S]*?END \$\$;/)?.[0];assert.ok(first);
    assert.match(first,/IF NOT EXISTS \([\s\S]*table_schema = 'public'[\s\S]*table_name = 'model_routes'[\s\S]*column_name = 'breaker_first_opened_at'[\s\S]*\) OR NOT EXISTS \(/);
    assert.match(first,/n.nspname = 'public' AND p.proname = 'job_route_close_refused'[\s\S]*p.prokind = 'f'/);
    assert.match(first,/RAISE EXCEPTION '0607 requires 0604_route_failure_accounting.sql \(PR 2685\)'/);
    assert.ok(sql.indexOf(first)<sql.indexOf('ALTER FUNCTION'));
    assert.match(sql,/telemetry_path_allowed_pre_0607\(p_path\)/);
    assert.doesNotMatch(sql,/pre_0601|CREATE OR REPLACE FUNCTION public.reserve_crun_create_slot/);
});
