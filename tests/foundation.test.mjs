import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, readConfig } from '../packages/security/config.js';
import { AI_ENVIRONMENTS } from '../packages/security/environments.js';
import { stripContext, verifiedContext, requireAal2, checkOrigin } from '../packages/security/context.js';
import { readJson, idempotencyKey } from '../packages/security/input.js';
import { errorResponse } from '../packages/security/errors.js';
import { securityLog } from '../packages/security/log.js';
const requestId = crypto.randomUUID(), userId = crypto.randomUUID();

test('environment selection isolates the two AI projects and excludes the wallet projects', () => {
    assert.equal(buildConfig({}).supabaseUrl, 'http://127.0.0.1:54321');
    assert.equal(buildConfig({APP_ENV:'staging',PUBLIC_HOST:'https://staging.example.invalid'}).supabaseUrl, AI_ENVIRONMENTS.staging.supabaseUrl);
    assert.equal(buildConfig({APP_ENV:'production'}).supabaseUrl, AI_ENVIRONMENTS.production.supabaseUrl);
    assert.throws(() => buildConfig({APP_ENV:'typo'}));
    for (const ref of ['jwstkrtslotnjyerzzsi','nszlbcmcysftwyudthjz','xdxdzmsztyzbnzeforxx']) {
        assert.throws(() => readConfig({APP_ENV:'staging',SUPABASE_URL:`https://${ref}.supabase.co`,NEXT_PUBLIC_SUPABASE_URL:`https://${ref}.supabase.co`,NEXT_PUBLIC_SUPABASE_ANON_KEY: AI_ENVIRONMENTS.staging.publishableKey,PUBLIC_HOST:'https://staging.example.com'}));
    }
    assert.throws(() => buildConfig({APP_ENV:'development',SUPABASE_URL:AI_ENVIRONMENTS.production.supabaseUrl}));
    assert.throws(() => readConfig({}));
});
test('spoofed current and future internal headers are stripped; bearer is retained', () => {
    const headers = stripContext(new Headers({'x-veyrnox-auth-aal':'aal2','x-veyrnox-org':'forged','x-request-id':'forged',authorization:'Bearer valid'}));
    assert.deepEqual([...headers], [['authorization','Bearer valid']]);
    const context = verifiedContext({sub:userId, user_metadata:{role:'OWNER'}, aal:'aal1'},requestId);
    assert.equal(context.authLevel,'aal1');
    assert.equal(context.roles,undefined);
    assert.throws(() => requireAal2(context));
    assert.doesNotThrow(() => requireAal2(verifiedContext({sub:userId,aal:'aal2'},requestId)));
});
test('browser origin policy refuses foreign or null origins, permits native bearer clients', () => {
    for (const origin of ['null','https://evil.example']) assert.throws(() => checkOrigin(new Request('https://ours.example',{headers:{origin}}),'https://ours.example'));
    checkOrigin(new Request('https://ours.example'),'https://ours.example');
});
test('JSON boundary enforces bytes without trusting content length and rejects unsupported representations', async () => {
    await assert.rejects(readJson(new Request('https://example.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'é'.repeat(100)})}),100),{status:413});
    await assert.rejects(readJson(new Request('https://example.com',{method:'POST',body:'{}'})),{status:415});
    await assert.rejects(readJson(new Request('https://example.com',{method:'POST',headers:{'content-type':'application/json'},body:'[]'})),{status:400});
});
test('header/body idempotency keys must agree', () => {
    const request = new Request('https://example.com',{headers:{'idempotency-key':'safe-key-123'}});
    assert.equal(idempotencyKey(request),'safe-key-123');
    assert.throws(() => idempotencyKey(request,'other-key-123'));
});
test('unexpected errors and structured logs do not serialize secret payloads', async () => {
    const response = errorResponse(new Error('secret-service-key SQL private-prompt'),requestId);
    assert.equal(response.status,500);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.ok(!(await response.text()).includes('secret-service-key'));
    let log=''; const prior=console.info; console.info=s=>{log=s;};
    try { securityLog('PROJECT_CREATED',{requestId,userId,secret:'secret-service-key',prompt:'private-prompt'}); }
    finally {console.info=prior;}
    assert.ok(!log.includes('secret-service-key') && !log.includes('private-prompt'));
});
