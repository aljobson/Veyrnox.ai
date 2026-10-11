import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyBrandKit } from '../lib/editorShared.js';
import { emptyProjectDocument,withTimeline } from '../lib/projectDocument.js';
import { emptySequence,addSequenceMedia,addSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { TEXT_DEFAULTS } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
const url=new URL(process.env.DATABASE_URL || '');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname))throw new Error('Shared-editor tests require a disposable local test database');
const db=new pg.Client({connectionString:url.href});await db.connect();
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const actor=async id=>{await db.query('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id||'']);await db.query('SET LOCAL ROLE authenticated');};
const admin=()=>db.query('RESET ROLE');
const reject=async(sql,args,code)=>{await db.query('SAVEPOINT expected_failure');try{await assert.rejects(db.query(sql,args),e=>e.code===code,code);}finally{await db.query('ROLLBACK TO SAVEPOINT expected_failure');}};
let count=0;const check=async(name,run)=>{await run();console.log(`ok ${++count} - ${name}`);};
try {
    await db.query('BEGIN');await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    const owner=randomUUID(),reviewer=randomUUID(),viewer=randomUUID(),outsider=randomUUID();
    for(const id of [owner,reviewer,viewer,outsider]){await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`shared-${id}@example.invalid`]);await db.query('SELECT private.provision_personal_tenant($1)',[id]);}
    const workspace=await scalar('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1',[owner]),org=await scalar('SELECT organisation_id FROM public.workspaces WHERE id=$1',[workspace]);
    await db.query("INSERT INTO public.organisation_members VALUES($1,$2,'REVIEWER'),($1,$3,'VIEWER')",[org,reviewer,viewer]);
    await actor(owner);const p=await scalar('SELECT public.create_project($1,$2,$3)',[workspace,'Shared editor','shared-project-key']);const project=p.project.id;
    await scalar('SELECT public.save_project_document($1,0,$2,$3,NULL)',[project,withTimeline(emptyProjectDocument(project),addSequenceClip(addSequenceMedia(emptySequence(),{id:'g-test',kind:'graphic',frames:18000,name:'Fixture',width:512,height:512,graphic:{shape:'circle',color:'#ffffff'}}),'video','g-test',{len:120})),'shared-document-key']);
    const kit={...emptyBrandKit(),textStyles:[{name:'Heading',size:8,style:{...TEXT_DEFAULTS,font:'Georgia',italic:true}}]};
    await check('brand kits persist workspace styles with optimistic versions and seven-day idempotency',async()=>{
        const saved=await scalar('SELECT public.save_editor_brand_kit($1,0,$2,$3)',[workspace,kit,'brand-save-key']);assert.equal(saved.version,1);assert.deepEqual(saved.kit,kit);
        const read=await scalar('SELECT public.read_editor_brand_kit($1)',[workspace]);assert.equal(read.canEdit,true);assert.deepEqual(read.kit,kit);
        assert.equal((await scalar('SELECT public.save_editor_brand_kit($1,0,$2,$3)',[workspace,kit,'brand-save-key'])).idempotent,true);
        await reject('SELECT public.save_editor_brand_kit($1,0,$2,$3)',[workspace,{...kit,name:'Changed'},'brand-save-key'],'PT409');
        await reject('SELECT public.save_editor_brand_kit($1,0,$2,$3)',[workspace,kit,'brand-stale-key'],'PT409');
    });
    await check('reviewers can add revision-pinned comments; viewers only read and editors resolve',async()=>{
        await actor(reviewer);assert.equal((await scalar('SELECT public.read_editor_brand_kit($1)',[workspace])).canEdit,false);
        await reject('SELECT public.save_editor_brand_kit($1,1,$2,$3)',[workspace,kit,'reviewer-brand-key'],'PT404');
        const saved=await scalar('SELECT public.add_editor_review_comment($1,1,45,$2,$3)',[project,'Change this shot\nPlease','reviewer-comment-key']);assert.equal(saved.comment.actor_id,reviewer);assert.equal(saved.comment.frame,45);assert.equal(saved.comment.revision,1);
        assert.equal((await scalar('SELECT public.add_editor_review_comment($1,1,45,$2,$3)',[project,'Change this shot\nPlease','reviewer-comment-key'])).idempotent,true);
        await reject('SELECT public.resolve_editor_review_comment($1,$2,1,true,$3)',[project,saved.comment.id,'reviewer-resolve-key'],'PT404');
        await actor(viewer);const view=await scalar('SELECT public.read_editor_review($1,1)',[project]);assert.equal(view.canComment,false);assert.equal(view.comments.length,1);
        await reject('SELECT public.add_editor_review_comment($1,1,0,$2,$3)',[project,'Viewer write','viewer-comment-key'],'PT404');
        await actor(owner);const resolved=await scalar('SELECT public.resolve_editor_review_comment($1,$2,1,true,$3)',[project,saved.comment.id,'owner-resolve-key']);assert.equal(resolved.comment.resolved,true);assert.equal(resolved.comment.resolved_by,owner);assert.equal(resolved.comment.version,2);
        assert.equal((await scalar('SELECT public.resolve_editor_review_comment($1,$2,1,true,$3)',[project,saved.comment.id,'owner-resolve-key'])).idempotent,true);
        await reject('SELECT public.resolve_editor_review_comment($1,$2,1,false,$3)',[project,saved.comment.id,'owner-stale-resolve-key'],'PT409');
    });
    await check('cross-tenant resources and cached requests stay inaccessible after membership revocation',async()=>{
        await actor(outsider);assert.equal(Number(await scalar('SELECT count(*) FROM public.workspace_editor_brand_kits WHERE workspace_id=$1',[workspace])),0);assert.equal(Number(await scalar('SELECT count(*) FROM public.project_editor_comments WHERE project_id=$1',[project])),0);
        await reject('SELECT public.read_editor_brand_kit($1)',[workspace],'PT404');await reject('SELECT public.read_editor_review($1,1)',[project],'PT404');
        await admin();await db.query('DELETE FROM public.organisation_members WHERE organisation_id=$1 AND user_id=$2',[org,reviewer]);await actor(reviewer);
        await reject('SELECT public.add_editor_review_comment($1,1,45,$2,$3)',[project,'Change this shot\nPlease','reviewer-comment-key'],'PT404');await actor(owner);
    });
    await check('direct database calls reject malformed kits, foreign assets, invalid revisions and control characters',async()=>{
        for(const bad of [{...kit,palette:['javascript:alert(1)']},{...kit,fonts:['https://unsafe.invalid/font']},{...kit,textStyles:[{name:'Bad',size:8,style:{...TEXT_DEFAULTS,lineHeight:100}}]},{...kit,extra:true}])await reject('SELECT public.save_editor_brand_kit($1,1,$2,$3)',[workspace,bad,randomUUID()],'PT400');
        const asset={projectId:randomUUID(),assetId:randomUUID(),name:'Other tenant',credit:'',usage:'',url:''};await reject('SELECT public.save_editor_brand_kit($1,1,$2,$3)',[workspace,{...kit,assets:[asset]},randomUUID()],'PT404');
        await reject('SELECT public.add_editor_review_comment($1,99,0,$2,$3)',[project,'Missing version',randomUUID()],'PT404');
        await reject('SELECT public.add_editor_review_comment($1,1,-1,$2,$3)',[project,'Invalid frame',randomUUID()],'PT400');
        await reject('SELECT public.add_editor_review_comment($1,1,120,$2,$3)',[project,'Past the saved edit',randomUUID()],'PT400');
        await reject('SELECT public.add_editor_review_comment($1,1,0,$2,$3)',[project,'Invalid\x01text',randomUUID()],'PT400');
    });
    await check('public tables deny direct writes; helpers and anonymous RPC execution are closed',async()=>{
        await reject('UPDATE public.workspace_editor_brand_kits SET version=999 WHERE workspace_id=$1',[workspace],'42501');await reject('DELETE FROM public.project_editor_comments WHERE project_id=$1',[project],'42501');
        await reject("SELECT private.editor_request_probe('op','unsafe-key','{}')",[],'42501');await admin();
        assert.equal(await scalar("SELECT has_function_privilege('anon','public.save_editor_brand_kit(uuid,integer,jsonb,text)','EXECUTE')"),false);
        assert.equal(await scalar("SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('public.workspace_editor_brand_kits'::regclass,'public.project_editor_comments'::regclass,'private.editor_requests'::regclass)"),true);
        assert.equal(await scalar("SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE oid IN ('public.save_editor_brand_kit(uuid,integer,jsonb,text)'::regprocedure,'public.add_editor_review_comment(uuid,integer,integer,text,text)'::regprocedure)"),true);await actor(owner);
    });
    await check('rate limits cap direct RPC writes without refusing idempotent replay',async()=>{
        await admin();await db.query("INSERT INTO private.editor_requests(actor_id,operation,key,payload,result) SELECT $1,'seed','seed-request-'||g,'{}','{}' FROM generate_series(1,30) g",[owner]);await actor(owner);
        await reject('SELECT public.add_editor_review_comment($1,1,0,$2,$3)',[project,'Over cap',randomUUID()],'PT429');assert.equal((await scalar('SELECT public.save_editor_brand_kit($1,0,$2,$3)',[workspace,kit,'brand-save-key'])).idempotent,true);
        await admin();await db.query("DELETE FROM private.editor_requests WHERE actor_id=$1 AND operation='seed'",[owner]);await actor(owner);
    });
    await check('comment listings expose truncation, project comments have a hard storage cap',async()=>{
        await admin();await db.query("INSERT INTO public.project_editor_comments(project_id,revision,frame,body,actor_id) SELECT $1,1,0,'Seed comment '||g,$2 FROM generate_series(1,1999) g",[project,owner]);await actor(owner);
        const read=await scalar('SELECT public.read_editor_review($1,1)',[project]);assert.equal(read.comments.length,20);assert.equal(read.total,2000);assert.equal(read.truncated,true);assert.ok(read.nextCursor);const page=await scalar('SELECT public.read_editor_review($1,1,$2)',[project,read.nextCursor]);assert.equal(page.comments.length,20);assert.ok(page.comments.every(c=>!read.comments.some(p=>p.id===c.id)));
        await reject('SELECT public.add_editor_review_comment($1,1,0,$2,$3)',[project,'Over project cap',randomUUID()],'PT429');
    });
    await check('auth deletion revokes access without deleting retained comments or blocking account deletion',async()=>{await admin();await db.query('DELETE FROM auth.users WHERE id=$1',[reviewer]);assert.equal(Number(await scalar('SELECT count(*) FROM private.editor_requests WHERE actor_id=$1',[reviewer])),0);assert.equal(Number(await scalar('SELECT count(*) FROM public.project_editor_comments WHERE actor_id=$1',[reviewer])),1);await actor(reviewer);await reject('SELECT public.read_editor_review($1,1)',[project],'PT404');});
    await check('soft-deleted projects hide their review history',async()=>{await admin();await db.query('UPDATE public.projects SET deleted_at=now() WHERE id=$1',[project]);await actor(owner);await reject('SELECT public.read_editor_review($1,1)',[project],'PT404');});
    console.log(`${count} shared-editor database checks passed; fixtures rolled back.`);
}finally{await db.query('ROLLBACK');await db.end();}
