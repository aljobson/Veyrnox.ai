import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {parseJsonc} from '../scripts/check-migration-ledger.mjs';
import {editorFeatureEnabled} from '../lib/editorRuntimeFlags.mjs';
import {publishRuntimeFeatureEnabled} from '../lib/social/runtimeFlags.js';
import {contentSecurityPolicy} from '../lib/contentSecurityPolicy.mjs';
import {LOCAL_SPEECH_WORKER_URL,localSpeechWorkerPolicy} from '../app/veyrnox/_lib/localSpeechAssets.mjs';
import {EDITOR_VISION_PATH,editorVisionWorkerPolicy} from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const {NextRequest}=await import('next/server.js');
const {middleware}=await import('../middleware.js');
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
test('owner-authorized document, private delivery and local inference features retain independent rollback gates',()=>{
    const config=parseJsonc(read('wrangler.jsonc'));
    for(const flag of ['EDITOR_LIBRARY_EXPORTS_ENABLED','EDITOR_ORGANIZATION_ENABLED','EDITOR_LOCAL_INFERENCE_ENABLED']){
        assert.equal(editorFeatureEnabled(flag,config.vars),true);assert.equal(editorFeatureEnabled(flag,config.env.staging.vars),true);
    }
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED',config.vars),false);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED',config.env.staging.vars),false);
});
test('only the exact enabled speech Worker receives a bounded WASM policy; the page and other paths remain closed',async()=>{
    const previous=process.env.EDITOR_LOCAL_INFERENCE_ENABLED;const nodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try{
        for(const [path,workerPolicy] of [[LOCAL_SPEECH_WORKER_URL,localSpeechWorkerPolicy],[`${EDITOR_VISION_PATH}/worker.mjs`,editorVisionWorkerPolicy]]){
            const url=`https://veyrnox.ai${path}`;
            process.env.EDITOR_LOCAL_INFERENCE_ENABLED='false';assert.equal((await middleware(new NextRequest(url))).status,404);
            process.env.EDITOR_LOCAL_INFERENCE_ENABLED='true';const worker=await middleware(new NextRequest(url));
            const policy=worker.headers.get('Content-Security-Policy');assert.equal(policy,workerPolicy('https://veyrnox.ai'));
            assert.match(policy,/wasm-unsafe-eval/);assert.match(policy,/worker-src 'none'/);assert.doesNotMatch(policy,/'unsafe-eval'|https:\s|blob:|data:/);
        }
        for(const path of ['/app/editor',`${LOCAL_SPEECH_WORKER_URL}/extra`,`${EDITOR_VISION_PATH}/worker.mjs/extra`,'/editor-speech/worker.mjs','/editor-vision/worker.mjs'])assert.doesNotMatch((await middleware(new NextRequest(`https://veyrnox.ai${path}`))).headers.get('Content-Security-Policy'),/wasm-unsafe-eval|unsafe-eval/);
        assert.doesNotMatch(contentSecurityPolicy(undefined,false,'production'),/wasm-unsafe-eval|unsafe-eval/);
    }finally{if(previous===undefined)delete process.env.EDITOR_LOCAL_INFERENCE_ENABLED;else process.env.EDITOR_LOCAL_INFERENCE_ENABLED=previous;if(nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=nodeEnv;}
});
