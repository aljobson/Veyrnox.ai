import { emptyFilm, SHOT_LANES, ACCEPTANCE_CHECKS } from './filmStudio.js';
const PREFIX = 'veyrnox_film_studio_v1:';
export const MAX_FILM_BYTES = 1_000_000;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const strings = (v, keys) => object(v) && keys.every(k => typeof v[k] === 'string' && v[k].length <= (k==='context'?MAX_FILM_BYTES:24000) && !v[k].includes('\0'));
const list = (v, limit, valid) => Array.isArray(v) && v.length <= limit && v.every(valid);
const key = userId => userId && /^[a-zA-Z0-9_-]{1,64}$/.test(userId) ? `${PREFIX}${userId}` : null;

export function parseFilm(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_FILM_BYTES) throw new Error('The studio file must be smaller than 1 MB.');
  let f;
  try { f = JSON.parse(raw); } catch { throw new Error('Choose a Film Studio JSON export.'); }
  const template = emptyFilm();
  if (!object(f) || f.schema !== 1 || !strings(f, ['name', 'script']) || !strings(f.stack, Object.keys(template.stack))
    || !['16:9', '9:16', '1:1'].includes(f.stack.aspect)
    || !list(f.shots, 200, s => strings(s, SHOT_LANES.flatMap(([,fields]) => fields.map(([k]) => k))) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(s.id) && typeof s.oneAction === 'boolean')
    || !list(f.boards, 300, b => strings(b, ['id', 'name', 'type', 'decision']) && ['character', 'location', 'prop', 'style'].includes(b.type)
      && list(b.references, 100, r => strings(r, ['source', 'caption', 'kind']) && ['reference', 'anti-reference'].includes(r.kind)))
    || !list(f.assets, 200, a => strings(a, ['tag', 'type', 'descriptor']) && /^@[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(a.tag)
      && Number.isInteger(a.version) && a.version >= 1 && a.version <= 9999 && ['character', 'location', 'prop'].includes(a.type)
      && list(a.references, 100, r => typeof r === 'string' && r.length <= 2000)
      && object(a.tests) && Object.keys(a.tests).length <= 1000 && Object.values(a.tests).every(t => strings(t, ['result', 'verdict']) && ['pending', 'pass', 'miss'].includes(t.verdict))
      && (!a.lock || strings(a.lock, ['context', 'at'])))
    || !list(f.prompts, 1000, p => strings(p, ['shot', 'content', 'context', 'at']) && Number.isInteger(p.version) && p.version > 0)
    || !list(f.attempts, 1000, a => strings(a, ['shot', 'result', 'verdict', 'changed', 'at']) && Number.isInteger(a.version) && a.version > 0
      && ['accepted', 'rejected'].includes(a.verdict) && (a.verdict!=='accepted'||list(a.checks,6,c=>ACCEPTANCE_CHECKS.includes(c))&&ACCEPTANCE_CHECKS.every(c=>a.checks.includes(c))))) throw new Error('This file is not a valid Film Studio export.');
  for(const [items,id] of [[f.shots,s=>s.id],[f.boards,b=>b.id],[f.assets,a=>`${a.tag}:v${a.version}`],[f.prompts,p=>`${p.shot}:${p.version}`],[f.attempts,a=>`${a.shot}:${a.version}`]])
    if(new Set(items.map(id)).size!==items.length) throw new Error('The studio file contains duplicate identifiers.');
  return f;
}
export function readFilm(storage, userId) {
  const k = key(userId);
  if (!k) return { film: emptyFilm(), error: null };
  try {
    const raw = storage.getItem(k);
    return { film: raw ? parseFilm(raw) : emptyFilm(), error: null };
  } catch { return { film: emptyFilm(), error: 'The saved studio could not be read. Export your current work before replacing it.' }; }
}
export function writeFilm(storage, userId, film) {
  const k = key(userId);
  if (!k) return false;
  const raw = JSON.stringify(film);
  parseFilm(raw);
  storage.setItem(k, raw);
  return true;
}
export function clearFilmLocal(storage) {
  try {
    for (const k of Object.keys(storage)) if (k.startsWith(PREFIX)) storage.removeItem(k);
  } catch { /* Auth can still end when browser storage is unavailable. */ }
}
