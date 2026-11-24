import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ownerProofExposure, hasOwnerProofExposure } from '../lib/ownerProofOverlay.mjs';
import { mediaGenerationSources } from '../app/veyrnox/_lib/chatMedia.js';
const read=path=>readFileSync(path,'utf8');
function initializer(source,name,match='') {
    const ast=ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let result;
    function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name&&node.initializer?.getText(ast).includes(match))result=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(result,name);return result;
}
test('actual phone model selection preserves swap projections with empty and populated overlays',()=>{
    const code=ts.transpileModule(read('apps/mobile/src/lib/swapScenes.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    const module={exports:{}};new Function('exports',code)(module.exports);
    const expression=initializer(read('apps/mobile/src/app/(app)/create/[modelId].tsx'),'model','privateModels');
    const choose=new Function('swapScene','publicModel','privateModels',`return ${expression}`);
    const raw={id:'swap-recast',durations:[5,10],capabilities:{media:{image:{},video:{},audio:{}}}};
    for(const people of [1,2]) for(const privateModels of [[],[{...raw,durations:[10]}]]) {
        const scene={people,credits:22};const projected=module.exports.swapSceneModel(raw,scene);
        const actual=choose(scene,projected,privateModels);
        assert.equal(actual,projected);assert.deepEqual(actual.durations,[5]);
        assert.deepEqual(actual.capabilities.media,{image:{required:true,maxFiles:people}});
    }
    assert.equal(choose(null,raw,[]),raw);
    const proof={...raw,durations:[8]};assert.equal(choose(null,raw,[proof]),proof);
});
test('private capability exposure covers carried images and remains model/account scoped',async()=>{
    const id='veo-3.1-lite-kie',sources={image:{assetId:'owned-image'}};
    assert.equal(ownerProofExposure(null,id,1,false,true),null);
    const exposed=ownerProofExposure(null,id,1,true,true);
    assert.equal(hasOwnerProofExposure(exposed,id,1),true);
    assert.equal(hasOwnerProofExposure(exposed,'other',1),false);
    assert.equal(hasOwnerProofExposure(exposed,id,2),false);
    assert.equal(ownerProofExposure(exposed,id,1,false,true),exposed);
    assert.equal(ownerProofExposure(exposed,id,1,false,false),null);
    await assert.rejects(mediaGenerationSources({id,media:{}},sources,()=>assert.fail('no upload'),{strict:hasOwnerProofExposure(exposed,id,1)}),{code:'source_type_unsupported'});
    assert.deepEqual(await mediaGenerationSources({id:'other',media:{}},sources,()=>assert.fail('no upload'),{strict:hasOwnerProofExposure(exposed,'other',1)}),{references:[],source_keys:[],source_assets:[]});
});
test('orphaned private source blocks submission but never the New generation reset',()=>{
    const source=read('app/veyrnox/app/create/page.js');const ast=ts.createSourceFile('page.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);let expression;
    function visit(node){if(ts.isJsxOpeningElement(node)&&node.attributes.properties.some(attr=>attr.name?.text==='data-assistant-target'&&attr.initializer?.text==='create.generate')) expression=node.attributes.properties.find(attr=>attr.name?.text==='disabled').initializer.expression.getText(ast);ts.forEachChild(node,visit);}visit(ast);
    const context={draftRecovery:{},sending:false,attachConverting:false,sourcesConverting:false,hasJobs:true,activeBatch:null,unsupportedSource:true};
    assert.equal(new Function(...Object.keys(context),`return !!(${expression})`)(...Object.values(context)),false);
    assert.match(source,/onClick=\{\(\) => pickSource\('image', null\)\}[^\n]*sources.image.remove/);
});
