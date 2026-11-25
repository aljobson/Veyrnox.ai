import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET as list, POST as create } from '../app/api/v1/project-folders/route.js';
import { PATCH as rename, DELETE as remove } from '../app/api/v1/project-folders/[id]/route.js';
import { PATCH as patchProject } from '../app/api/v1/projects/[id]/route.js';
import { GET as getProject } from '../app/api/v1/projects/[id]/route.js';
import { GET as listProjects } from '../app/api/v1/projects/route.js';

const user=crypto.randomUUID(), workspace=crypto.randomUUID(), folder=crypto.randomUUID(), project=crypto.randomUUID();
Object.assign(process.env,{APP_ENV:'development',PUBLIC_HOST:'http://localhost:3000',SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_local_test',TENANT_PROJECTS_ENABLED:'true'});
const original=globalThis.fetch; test.after(()=>{globalThis.fetch=original;});
const request=(url,method='GET',body,headers={})=>new Request(`http://localhost:3000/api/v1/${url}`,{method,headers:{authorization:'Bearer user-token','x-veyrnox-auth-id':user,'x-request-id':crypto.randomUUID(),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const params=id=>({params:Promise.resolve({id})});

test('folder list is workspace-scoped and create forwards a bounded parent plus idempotency',async()=>{
 const calls=[]; globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:init.body&&JSON.parse(init.body)});return calls.length===1?Response.json([{id:folder,workspace_id:workspace,parent_id:null,name:'Campaigns',version:1}]):Response.json({folder:{id:folder},idempotent:false});};
 const listed=await list(request(`project-folders?workspace_id=${workspace}`));assert.equal(listed.status,200);assert.match(calls[0].url,/project_folders\?workspace_id=eq\./);
 const made=await create(request('project-folders','POST',{workspace_id:workspace,parent_id:null,name:' Campaigns '},{'idempotency-key':'folder-key-123'}));assert.equal(made.status,201);
 assert.deepEqual(calls[1].body,{p_workspace_id:workspace,p_parent_id:null,p_name:'Campaigns',p_idempotency_key:'folder-key-123'});
});
test('rename, guarded delete and project move use separate RPC contracts',async()=>{
 const calls=[];globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return Response.json(body.p_folder_id&&body.p_project_id?{id:project,folder_id:body.p_folder_id,version:2}:body.p_remove?{id:folder}:{id:folder,name:body.p_name,version:2});};
 assert.equal((await rename(request(`project-folders/${folder}`,'PATCH',{name:'Client work',version:1}),params(folder))).status,200);
 assert.equal((await remove(request(`project-folders/${folder}`,'DELETE',{version:2}),params(folder))).status,200);
 assert.equal((await patchProject(request(`projects/${project}`,'PATCH',{folder_id:folder,version:1}),params(project))).status,200);
 assert.deepEqual(calls[2],{p_project_id:project,p_expected_version:1,p_folder_id:folder});
});
test('folder routes reject malformed identifiers, versions and mixed project patches before upstream',async()=>{
 globalThis.fetch=async()=>{throw new Error('must not reach upstream');};
 assert.equal((await list(request('project-folders?workspace_id=bad'))).status,400);
 assert.equal((await create(request('project-folders','POST',{workspace_id:workspace,parent_id:'bad',name:'x'},{'idempotency-key':'folder-key-123'}))).status,400);
 assert.equal((await rename(request(`project-folders/${folder}`,'PATCH',{name:'x',version:0}),params(folder))).status,400);
 assert.equal((await patchProject(request(`projects/${project}`,'PATCH',{folder_id:folder,name:'x',version:1}),params(project))).status,400);
});
test('folder conflicts preserve their safe codes for clients',async()=>{
 globalThis.fetch=async()=>Response.json({code:'PT409',message:'FOLDER_NOT_EMPTY',details:'private detail'},{status:409});
 const response=await remove(request(`project-folders/${folder}`,'DELETE',{version:2}),params(folder));
 assert.equal(response.status,409);assert.equal((await response.json()).error.code,'FOLDER_NOT_EMPTY');
 globalThis.fetch=async()=>Response.json({code:'PT429',message:'LIMIT_REACHED'},{status:429});
 const limited=await create(request('project-folders','POST',{workspace_id:workspace,parent_id:null,name:'Campaigns'},{'idempotency-key':'folder-key-123'}));
 assert.equal(limited.status,429);assert.equal((await limited.json()).error.code,'LIMIT_REACHED');
});
test('project reads survive a rolling deploy before folder_id exists',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;if(calls<3)return Response.json({message:'column projects.folder_id does not exist'},{status:400});return Response.json([{id:project,workspace_id:workspace,name:'Legacy',version:1}]);};
 const listed=await listProjects(request(`projects?workspace_id=${workspace}`));
 assert.equal(listed.status,200);assert.equal((await listed.json()).projects[0].folder_id,null);assert.equal(calls,3);
 calls=0;globalThis.fetch=async()=>{calls++;if(calls===1)return Response.json({message:'column projects.folder_id does not exist'},{status:400});return Response.json([{id:project,workspace_id:workspace,name:'Legacy',version:1}]);};
 const single=await getProject(request(`projects/${project}`),params(project));
 assert.equal(single.status,200);assert.equal((await single.json()).project.folder_id,null);assert.equal(calls,2);
});
test('migration bounds depth and counts, enforces same-workspace folders, RLS and conflict-safe moves',()=>{
 const sql=readFileSync(new URL('../packages/db/schema/supabase/0618_project_folders.sql',import.meta.url),'utf8');
 for(const evidence of ['FORCE ROW LEVEL SECURITY','private.workspace_role(workspace_id)','parent_depth >= 4','count(*) FROM public.project_folders','projects_folder_fk','FOLDER_NOT_EMPTY','expected_version','move_project_to_folder','ON DELETE SET NULL (folder_id)','PROJECT_FOLDER_CREATED','check_project_folder_write_limit','clear_project_folder_on_delete']) assert.ok(sql.includes(evidence),`missing migration evidence: ${evidence}`);
 assert.equal((sql.match(/e\.action IN \('PROJECT_FOLDER_CREATED','PROJECT_FOLDER_RENAMED','PROJECT_FOLDER_DELETED','PROJECT_FOLDER_MOVED'\)/g)||[]).length,2);
 assert.doesNotMatch(sql,/created_at>now\(\)-interval '1 (?:minute|day)'\) >=/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE) ON public\.project_folders TO authenticated/i);
});
test('web and shared native projects expose folder filtering, nested creation and project moves',()=>{
 const web=readFileSync(new URL('../app/veyrnox/app/projects/page.js',import.meta.url),'utf8');
 const nativeList=readFileSync(new URL('../apps/mobile/src/app/(app)/projects/index.tsx',import.meta.url),'utf8');
 const nativeDetail=readFileSync(new URL('../apps/mobile/src/app/(app)/projects/[id].tsx',import.meta.url),'utf8');
 for(const evidence of ['project-folder-filter','parent_id: parent || null','folder-create','moveProject']) assert.ok(web.includes(evidence),`web projects missing ${evidence}`);
 for(const evidence of ['fetchProjectFolders','createProjectFolder','renameProjectFolder','deleteProjectFolder','folderFilter','folderLabel','Promise.allSettled']) assert.ok(nativeList.includes(evidence),`native projects missing ${evidence}`);
 for(const evidence of ['moveProjectToFolder','folderChoices','project.folderId']) assert.ok(nativeDetail.includes(evidence),`native project detail missing ${evidence}`);
});
