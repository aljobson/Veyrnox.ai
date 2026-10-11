import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptySequence,addSequenceText} from '../app/veyrnox/_lib/editorSequence.mjs';
import {TEXT_DEFAULTS} from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import {createFolder,addCustomFont,customFontFamily} from '../app/veyrnox/_lib/editorOrganization.mjs';
import {emptyProjectDocument,withTimeline} from '../lib/projectDocument.js';
const url=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname))throw new Error('Organization checks require a disposable local test database.');
const db=new pg.Client({connectionString:url.href});await db.connect();
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const actor=async id=>{await db.query('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id]);await db.query('SET LOCAL ROLE authenticated');};
const reject=async args=>{await db.query('SAVEPOINT refusal');try{await assert.rejects(db.query('SELECT public.save_project_document($1,$2,$3,$4,NULL)',args),e=>e.code==='PT400');}finally{await db.query('ROLLBACK TO SAVEPOINT refusal');}};
try{
    await db.query('BEGIN');await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');const owner=randomUUID();
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[owner,`font-${owner}@example.invalid`]);
    const workspace=await scalar('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1',[owner]);await actor(owner);
    const project=(await scalar('SELECT public.create_project($1,$2,$3)',[workspace,'Font and folder test','font-project-test'])).project.id;
    const sha256='a'.repeat(64),font={family:customFontFamily(sha256),name:'Licensed font',sourceName:'font.woff2',sha256,bytes:1024,format:'woff2',rights:{credit:'Author',usage:'Commercial font licence',url:'https://example.invalid/licence'}};
    const tl=addSequenceText(addCustomFont(createFolder(emptySequence(),'Campaign/Empty'),font),{style:{...TEXT_DEFAULTS,font:font.family}}),doc=withTimeline(emptyProjectDocument(project),tl);
    const saved=await scalar('SELECT public.save_project_document($1,0,$2,$3,NULL)',[project,doc,'font-save-key']);assert.deepEqual(saved.document,doc);
    assert.equal((await scalar('SELECT public.save_project_document($1,0,$2,$3,NULL)',[project,doc,'font-save-key'])).idempotent,true);console.log('ok 1 - folders, font rights/hash and text appearance save/replay intact');
    const bad=[...['bad','',null,{},['../x'],['x','x'],['a//b'],['a/b/c/d/e']].map(folders=>({...tl,folders})),...['bad',null,{},[{}],[{...font,bytes:2097153}],[{...font,bytes:'12'}],[{...font,sha256:'bad'}],[{...font,rights:{...font.rights,usage:''}}],[{...font,rights:{...font.rights,url:'https://user:pass@example.invalid/'}}],[]].map(fonts=>({...tl,fonts}))];
    for(const timeline of bad)await reject([project,1,{...doc,timeline},randomUUID()]);assert.equal(Number(await scalar('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),1);console.log('ok 2 - malformed direct metadata saves append no revisions and return typed refusal');
    await scalar('SELECT public.save_project_document($1,1,$2,$3,NULL)',[project,emptyProjectDocument(project),'font-old-doc-key']);
    const restored=await scalar('SELECT public.save_project_document($1,2,NULL,$2,1)',[project,'font-restore-key']);assert.deepEqual(restored.document,doc);console.log('ok 3 - legacy documents and append-only restore remain compatible');
    await db.query('RESET ROLE');for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("SELECT has_function_privilege($1,'private.project_editor_organization_within_bounds(jsonb)','EXECUTE')",[role]),false);console.log('ok 4 - organization helper has no exposed API execution grant');
}finally{await db.query('ROLLBACK');await db.end();}
