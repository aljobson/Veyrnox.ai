#!/usr/bin/env node
// Follow client import graphs; direct-file greps miss transitive credential leaks.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
async function files(dir) {
    const entries=await readdir(dir,{withFileTypes:true});
    return (await Promise.all(entries.map(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.[cm]?[jt]sx?$/.test(e.name)?[path.join(dir,e.name)]:[]))).flat();
}
async function resolve(from,target) {
    if(!target.startsWith('.')) return null;
    const base=path.resolve(path.dirname(from),target);
    for(const suffix of ['','.js','.jsx','.mjs','.ts','.tsx','/index.js']) {
        if(await stat(base+suffix).then(s=>s.isFile()).catch(()=>false)) return base+suffix;
    }
    return null;
}
const visited=new Set();
async function inspect(file) {
    if(visited.has(file))return;
    visited.add(file);
    const relative=path.relative(root,file);
    if(/^packages\/(adapters|provider-sdk|db)\//.test(relative)) throw new Error(`Server package reachable from client: ${relative}`);
    const source=await readFile(file,'utf8');
    const executable=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    if(/process\.env\.(?:FAL_KEY|KIE_API_KEY|OPENROUTER_API_KEY|GRSAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|R2_SECRET_ACCESS_KEY)/.test(executable)) throw new Error(`Server credential reachable from client: ${relative}`);
    if(/NEXT_PUBLIC_[A-Z_]*(?:SECRET|SERVICE_ROLE|PRIVATE_KEY)/.test(executable)) throw new Error(`Secret-shaped public setting: ${relative}`);
    for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
        const target=await resolve(file,match[1]); if(target)await inspect(target);
    }
}
for(const file of [...await files(path.join(root,'app')),...await files(path.join(root,'components'))]) {
    const source=await readFile(file,'utf8');
    if(/^\s*['"]use client['"]/.test(source))await inspect(file);
}
console.log(`Client boundary checks passed (${visited.size} modules)`);
