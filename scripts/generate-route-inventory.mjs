import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTTP = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : /^(route|page)\.js$/.test(entry.name) ? [join(dir, entry.name)] : []))).flat();
}
export function exportedMethods(source) {
  const file = ts.createSourceFile('route.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods = new Set();
  for (const node of file.statements) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) if (HTTP.has(element.name.text)) methods.add(element.name.text);
    }
    if (!node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(node) && HTTP.has(node.name?.text)) methods.add(node.name.text);
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && HTTP.has(d.name.text)) methods.add(d.name.text);
    }
  }
  return [...methods].sort();
}
export async function inventory(appRoot = join(root, 'app')) {
  const rows = new Map();
  for (const file of (await walk(appRoot)).sort()) {
    const parts = relative(appRoot, file).split('/');
    const page = parts.pop() === 'page.js';
    if (parts.some(p => p.startsWith('_'))) continue;
    const routeParts = parts.filter(p => !p.startsWith('(') && !p.startsWith('@'));
    if (routeParts[0] === 'veyrnox') routeParts.shift();
    const path = '/' + routeParts.map(p => p.replace(/^\[\[\.\.\.(.+)\]\]$/, ':$1*')
      .replace(/^\[\.\.\.(.+)\]$/, ':$1+').replace(/^\[(.+)\]$/, ':$1')).join('/');
    const gate = page ? 'page' : /^\/api\/(?:v1\/)?admin(?:\/|$)/.test(path) ? 'admin'
      : path.startsWith('/api/webhook/') ? 'webhook' : path.startsWith('/api/v1/') ? 'v1' : 'public';
    const key = path + ':' + gate;
    const methods = page ? ['GET'] : exportedMethods(await readFile(file, 'utf8'));
    rows.set(key, { path, methods: [...new Set([...(rows.get(key)?.methods || []), ...methods])].sort(), gate });
  }
  return [...rows.values()].sort((a,b) => a.path.localeCompare(b.path, 'en') || a.gate.localeCompare(b.gate, 'en'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = join(root, 'lib/adminRouteInventory.json');
  const output = JSON.stringify(await inventory()) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8').catch(() => '') !== output) {
      console.error('Route inventory is stale. Run node scripts/generate-route-inventory.mjs');
      process.exitCode = 1;
    } else console.log('Route inventory is current.');
  } else { await writeFile(file, output); console.log('Route inventory generated.'); }
}
