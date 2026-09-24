import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptSession, getSession } from '../app/lib/authClient.js';
import { changePassword, requestPasswordCode, revokeSessions } from '../app/lib/accountSecurity.js';
const store = new Map();
globalThis.localStorage = { getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,v), removeItem:k=>store.delete(k) };
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL:'https://auth.test', NEXT_PUBLIC_SUPABASE_ANON_KEY:'test' });
const signIn = id => adoptSession({access_token:id,expires_in:3600,user:{id}});

test('password updates validate inputs and send nonce only in authenticated JSON', async () => {
    signIn('a');
    globalThis.fetch = () => assert.fail('invalid input reached auth');
    await assert.rejects(changePassword('short','123456'));
    await assert.rejects(changePassword('long-enough','bad-code'));
    globalThis.fetch = async (url,init) => {
        assert.equal(new URL(url).pathname,'/auth/v1/user');
        assert.equal(init.method,'PUT');
        assert.deepEqual(JSON.parse(init.body),{password:'long-enough',nonce:'123456'});
        assert.equal(init.headers.Authorization,'Bearer a');
        return Response.json({id:'a'});
    };
    await changePassword('long-enough','123456');
});
test('reauthentication uses the existing GoTrue session', async () => {
    signIn('a');
    globalThis.fetch = async (url,init) => {
        assert.equal(new URL(url).pathname,'/auth/v1/reauthenticate');
        assert.equal(init.method,'GET'); return Response.json({});
    };
    await requestPasswordCode();
});
test('other-device revocation preserves this session; global revocation clears it only on success', async () => {
    signIn('a');
    const scopes=[];
    globalThis.fetch = async url => {scopes.push(new URL(url).searchParams.get('scope'));return Response.json({});};
    await revokeSessions('others');assert.equal(getSession().user.id,'a');
    await revokeSessions('global');assert.equal(getSession(),null);
    assert.deepEqual(scopes,['others','global']);
    signIn('a');globalThis.fetch=async()=>new Response('{}',{status:503});
    await assert.rejects(revokeSessions('global'));assert.equal(getSession().user.id,'a');
});

test('email recovery sign-in binds its code to this browser and our callback', async () => {
    const { sendMagicLink } = await import('../app/lib/authClient.js');
    globalThis.sessionStorage = globalThis.localStorage;
    globalThis.window = { location: { origin:'https://veyrnox.test' } };
    globalThis.fetch = async (url,init) => {
        const u = new URL(url), body = JSON.parse(init.body);
        assert.equal(u.pathname,'/auth/v1/otp');
        assert.equal(u.searchParams.get('redirect_to'),'https://veyrnox.test/auth/callback');
        assert.equal(body.code_challenge_method,'s256');
        assert.match(body.code_challenge,/^[A-Za-z0-9_-]{43}$/);
        const verifier=store.get('veyrnox_pkce_verifier');
        const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
        assert.equal(digest,body.code_challenge);
        assert.equal(body.gotrue_meta_security.captcha_token,'captcha');
        return Response.json({});
    };
    await sendMagicLink('user@test.invalid','captcha');
});
