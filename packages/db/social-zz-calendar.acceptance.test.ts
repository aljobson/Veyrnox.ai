import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

describe('Publish calendar and safe rescheduling (0192)',{skip:!process.env.DATABASE_URL},()=>{
    let pool:pg.Pool;
    const one=async(sql:string,args:unknown[]=[]) => (await pool.query(sql,args)).rows[0];
    const future=(days=2)=>new Date(Date.now()+days*86400000).toISOString();
    before(async()=>{
        pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:12});
        const apply=async(name:string)=>pool.query(await readFile(new URL(`./schema/supabase/${name}`,import.meta.url),'utf8'));
        if(!(await one("SELECT to_regclass('public.social_posts') t")).t){
            for(const name of ['0154_social_publish_foundation.sql','0156_social_publish_scheduling.sql','0160_social_publish_composer.sql',
                '0161_social_publish_async_engine.sql','0168_social_publish_claim_guards.sql','0182_social_post_drafts.sql'])await apply(name);
        }
        await apply('0182_social_post_drafts.sql');
        await apply('0192_social_publish_calendar.sql');await apply('0192_social_publish_calendar.sql');
    });
    after(async()=>{await pool?.end();});
    async function fixture(){
        const auth=randomUUID();await pool.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)',[auth,`${auth}@test.veyrnox.ai`]);
        const user=(await one('SELECT public.provision_user($1,$2) id',[auth,`${auth}@test.veyrnox.ai`])).id;
        const brand=(await one('SELECT public.get_or_create_default_social_brand($1) r',[auth])).r.brand_id;
        const account=(await one('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,NULL,$6,$7,NULL,NULL) r',[auth,brand,'instagram',randomUUID(),'@fixture',['scope'],Buffer.from('private-token')])).r.account_id;
        return {auth,user,brand,account};
    }
    async function post(a:any,at=future(),status='scheduled',network='instagram'){
        const id=randomUUID();
        await pool.query('INSERT INTO public.social_posts(id,brand_id,created_by_user_id,scheduled_at,idempotency_key,status,draft_batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,a.brand,a.user,at,randomUUID().replaceAll('-',''),status,status==='draft'?randomUUID():null]);
        const target=(await one('INSERT INTO public.social_post_targets(post_id,account_id,network) VALUES ($1,$2,$3) RETURNING id',[id,a.account,network])).id;
        return {id,target,at};
    }
    const list=async(a:any,from=new Date().toISOString(),to=future(42),status:null|string=null,network:null|string=null,after:any=null)=>
        (await one('SELECT public.list_social_calendar($1,$2,$3,$4,$5,$6,$7,$8) r',[a.auth,a.brand,from,to,status,network,after?.at||null,after?.id||null])).r;
    const move=async(a:any,p:any,at=future(3),expected=p.at)=>(await one('SELECT public.reschedule_social_post($1,$2,$3,$4) r',[a.auth,p.id,expected,at])).r;
    it('lists by scheduled time, with exclusive end, filters and no drafts or credentials',async()=>{
        const a=await fixture();const at=future(2),end=future(4);
        const p=await post(a,at);await post(a,future(1),'published','tiktok');await post(a,end);await post(a,at,'draft');
        const r=await list(a,new Date().toISOString(),end);
        assert.equal(r.posts.length,2);assert.equal(r.posts[1].id,p.id);assert.equal(r.posts[1].can_reschedule,true);
        assert.equal(r.posts[0].can_reschedule,false);assert.ok(!JSON.stringify(r).includes('private-token'));
        assert.equal((await list(a,new Date().toISOString(),end,'scheduled','instagram')).posts.length,1);
        assert.deepEqual((await list({...a,auth:'bad'})).code,'USER_NOT_FOUND');
        const b=await fixture();assert.equal((await list({...a,auth:b.auth})).code,'BRAND_NOT_FOUND');
        assert.equal((await list(a,new Date().toISOString(),future(50))).code,'INVALID_RANGE');
    });
    it('paginates tied timestamps without gaps or duplicates',async()=>{
        const a=await fixture(),at=future();
        for(let i=0;i<103;i++)await post(a,at);
        const first=await list(a);assert.equal(first.posts.length,100);assert.ok(first.next);
        const second=await list(a,undefined,undefined,null,null,first.next);assert.equal(second.posts.length,3);assert.equal(second.next,null);
        assert.equal(new Set([...first.posts,...second.posts].map(p=>p.id)).size,103);
    });
    it('moves every target, logs once on replay and rejects stale edits',async()=>{
        const a=await fixture(),p=await post(a),at=future(3);
        const secondAccount=(await one("INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc) VALUES ($1,'tiktok',$2,$3) RETURNING id",[a.brand,randomUUID(),Buffer.from('second-token')])).id;
        await pool.query("INSERT INTO public.social_post_targets(post_id,account_id,network) VALUES ($1,$2,'tiktok')",[p.id,secondAccount]);
        const changed=await move(a,p,at);assert.equal(changed.ok,true);assert.equal(changed.idempotent,false);assert.equal(Date.parse(changed.scheduled_at),Date.parse(at));
        assert.equal((await move(a,p,at)).idempotent,true);
        assert.equal((await move(a,p,future(4))).code,'SCHEDULE_CHANGED');
        const t=await one('SELECT next_attempt_at,attempts,claimed_at FROM public.social_post_targets WHERE id=$1',[p.target]);
        assert.equal((await one('SELECT count(*)::int n FROM public.social_post_targets WHERE post_id=$1 AND next_attempt_at=$2',[p.id,at])).n,2);
        assert.equal(t.next_attempt_at.toISOString(),at);assert.equal(t.attempts,0);assert.equal(t.claimed_at,null);
        assert.equal((await one("SELECT count(*)::int n FROM public.social_account_actions WHERE action='post_rescheduled' AND target_id=$1",[p.id])).n,1);
    });
    it('refuses foreign, started, retried, partially delivered and terminal posts',async()=>{
        const a=await fixture(),b=await fixture();const foreign=await post(a);
        assert.equal((await move(b,foreign)).code,'POST_NOT_FOUND');
        assert.equal((await move(a,foreign,'infinity')).code,'INVALID_SCHEDULE');
        assert.equal((await move(a,foreign,new Date().toISOString())).code,'INVALID_SCHEDULE');
        for(const state of ['publishing','submitted','published','delivered','failed']){
            const p=await post(a);await pool.query('UPDATE public.social_post_targets SET publish_status=$2 WHERE id=$1',[p.target,state]);
            assert.equal((await move(a,p)).code,'POST_STARTED');
        }
        const retry=await post(a);await pool.query('UPDATE public.social_post_targets SET attempts=1 WHERE id=$1',[retry.target]);assert.equal((await move(a,retry)).code,'POST_STARTED');
        for(const status of ['published','failed','canceled','draft'])assert.equal((await move(a,await post(a,future(),status))).code,'POST_STARTED');
    });
    it('serializes competing edits with exactly one winner',async()=>{
        const a=await fixture(),p=await post(a),at=future(5),other=future(6);
        const r=await Promise.all([move(a,p,at),move(a,p,other)]);
        assert.equal(r.filter(x=>x.ok).length,1);assert.ok(['SCHEDULE_CHANGED','POST_BUSY'].includes(r.find(x=>!x.ok).code));
    });
    it('never both moves and claims the same due post during concurrent sweeps',async()=>{
        for(let i=0;i<12;i++){
            const a=await fixture(),p=await post(a,new Date(Date.now()-60000).toISOString());
            const tasks=[()=>move(a,p),()=>pool.query('SELECT * FROM public.claim_due_social_post_targets(50)')];
            if(i%2)tasks.reverse();const r=await Promise.all(tasks.map(f=>f()));
            const moved=r.find((x:any)=>'ok' in x) as any;const claimed=(r.find((x:any)=>'rows' in x) as any).rows.some((x:any)=>x.post_id===p.id);
            assert.equal(moved.ok&&claimed,false);
            if(moved.ok){assert.equal((await one('SELECT attempts FROM public.social_post_targets WHERE id=$1',[p.target])).attempts,0);}
            else assert.ok(['POST_STARTED','POST_BUSY'].includes(moved.code));
        }
    });
    it('returns a busy conflict without changing the schedule and can retry after unlock',async()=>{
        const a=await fixture(),p=await post(a),holder=await pool.connect();
        try{
            await holder.query('BEGIN');await holder.query('SELECT id FROM public.social_post_targets WHERE id=$1 FOR UPDATE',[p.target]);
            assert.equal((await move(a,p)).code,'POST_BUSY');
            assert.equal((await one('SELECT scheduled_at FROM public.social_posts WHERE id=$1',[p.id])).scheduled_at.toISOString(),p.at);
            await holder.query('ROLLBACK');
            assert.equal((await move(a,p)).ok,true);
        }finally{await holder.query('ROLLBACK');holder.release();}
    });
    it('keeps both RPCs service-only with an empty search path',async()=>{
        for(const fn of ['public.list_social_calendar(text,uuid,timestamptz,timestamptz,text,text,timestamptz,uuid)','public.reschedule_social_post(text,uuid,timestamptz,timestamptz)']){
            for(const role of ['anon','authenticated','service_role'])assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') b",[role,fn])).b,role==='service_role');
            const f=await one('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[fn]);assert.equal(f.prosecdef,true);assert.ok(f.proconfig.includes('search_path=""'));
        }
    });
});
