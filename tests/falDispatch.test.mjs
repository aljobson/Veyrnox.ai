import test from 'node:test';
import assert from 'node:assert/strict';
import { runFalDispatch, falDispatchEnabled } from '../lib/falDispatch.js';
const env = { FAL_DISPATCH_SCHEMA_ENABLED: 'true', FAL_DURABLE_DISPATCH_ENABLED: 'true',
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test' };
const job = { job_id: 'test-job', attempt_token: 'test-token', endpoint: 'fal-ai/flux-2-pro', payload: { prompt: 'test' } };
function deps({ count = 1, answer = { outcome: 'accepted', providerJobId: 'handle' }, evidenceFailures = 0, persist = true,
    recovery = { ok: true }, claimError = false, submitThrow = false, now } = {}) {
    let submitted = 0, claims = 0, records = 0;
    const calls = [];
    return {
        calls, get submitted() { return submitted; },
        rpc: async (name, args) => {
            calls.push({ name, args });
            if (name === 'recover_fal_dispatch') return recovery;
            if (name === 'start_fal_dispatch') {
                if (claimError) throw new Error('claim acknowledgement lost');
                return claims++ < count ? { ...job, job_id: `test-job-${claims}` } : null;
            }
            if (name === 'record_fal_dispatch') {
                if (records++ < evidenceFailures) throw new Error('evidence acknowledgement lost');
                return { ok: persist };
            }
            throw new Error(name);
        },
        submit: async (input, cfg) => {
            submitted++;
            assert.deepEqual(input.inputs, job.payload);
            assert.equal(cfg.webhookBaseUrl, 'https://veyrnox.test/api/webhook/fal');
            if (submitThrow) throw new Error('connection lost');
            return answer;
        }, ...(now ? { now } : {}),
    };
}
test('admission requires both switches, disabled recovery touches nothing', async () => {
    assert.equal(falDispatchEnabled(env), true);
    assert.equal(falDispatchEnabled({ ...env, FAL_DISPATCH_SCHEMA_ENABLED: 'false' }), false);
    const d = deps();
    assert.equal((await runFalDispatch({ ...env, FAL_DISPATCH_SCHEMA_ENABLED: 'false' }, d)).disabled, true);
    assert.equal(d.calls.length, 0);
});
test('rollback of admission still drains existing work', async () => {
    const d = deps();
    assert.equal((await runFalDispatch({ ...env, FAL_DURABLE_DISPATCH_ENABLED: 'false' }, d)).ok, true);
    assert.equal(d.submitted, 1);
});
test('missing secrets or invalid callback host never claim work', async () => {
    for (const changed of [{ FAL_KEY: '' }, { PUBLIC_HOST: 'http://veyrnox.test' }]) {
        const d = deps();
        assert.equal((await runFalDispatch({ ...env, ...changed }, d)).ok, false);
        assert.equal(d.calls.length, 0);
    }
});
test('lost claim acknowledgement never causes a submit', async () => {
    const d = deps({ claimError: true });
    await assert.rejects(runFalDispatch(env,d), /acknowledgement/);
    assert.equal(d.submitted, 0);
});
test('lost evidence acknowledgement retries the same write, never the provider call', async () => {
    const d = deps({ evidenceFailures: 1 });
    assert.equal((await runFalDispatch(env,d)).ok,true);
    assert.equal(d.submitted,1);
    const writes = d.calls.filter(c => c.name === 'record_fal_dispatch');
    assert.equal(writes.length,2); assert.deepEqual(writes[0].args,writes[1].args);
    assert.equal(writes[0].args.p_provider_job_id,'handle');
});
test('evidence outage stops new spend after one submit and logs retained handle only', async (t) => {
    const logs=[]; t.mock.method(console,'error', value => logs.push(value));
    const d=deps({ count:20, persist:false });
    assert.equal((await runFalDispatch(env,d)).ok,false); assert.equal(d.submitted,1);
    const log=JSON.parse(logs[0]); assert.equal(log.provider_job_id,'handle');
    assert.equal(log.job_id,'test-job-1'); assert.equal(log.prompt,undefined);
});
test('throwing submit becomes UNKNOWN evidence without a submit retry', async (t) => {
    t.mock.method(console,'error',()=>{});
    const d=deps({submitThrow:true});
    assert.equal((await runFalDispatch(env,d)).failed,1); assert.equal(d.submitted,1);
    const write=d.calls.find(c=>c.name==='record_fal_dispatch');
    assert.equal(write.args.p_outcome,'UNKNOWN'); assert.equal(write.args.p_provider_job_id,null);
});
test('refusal stores evidence for transactional refund recovery', async () => {
    const d=deps({answer:{outcome:'rejected'}});
    assert.equal((await runFalDispatch(env,d)).ok,true);
    assert.equal(d.calls.find(c=>c.name==='record_fal_dispatch').args.p_outcome,'REJECTED');
    assert.equal(d.calls.at(-2).name,'recover_fal_dispatch');
});
test('recovery failure prevents spending, and invocation cap is ten', async () => {
    const bad=deps({recovery:{ok:false}});
    assert.equal((await runFalDispatch(env,bad)).ok,false); assert.equal(bad.submitted,0);
    const many=deps({count:20});
    assert.equal((await runFalDispatch(env,many)).submitted,10);
});
test('work budget expires before another claim', async () => {
    let calls=0;
    const d=deps({count:20,now:()=>calls++===0?0:180_000});
    assert.equal((await runFalDispatch(env,d)).submitted,0);
    assert.equal(d.calls.filter(c=>c.name==='start_fal_dispatch').length,0);
});
