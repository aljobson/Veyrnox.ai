'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { Button } from '../../_components/Button';
import { AI_DISCLOSURES } from '../../../../lib/cinema/domain';
const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const labels = { FILM: 'Film', SHORT: 'Short', TRAILER: 'Trailer', SERIES: 'Series', SEASON: 'Season', EPISODE: 'Episode' };
const disclosureLabels = { generated_video: 'Generated video', generated_voice: 'Generated voice', generated_music: 'Generated music', synthetic_people: 'Synthetic people', face_replacement: 'Face replacement', cloned_voice: 'Cloned voice', generated_script: 'Generated script', manipulated_real_world_footage: 'Manipulated real-world footage' };
const input = 'mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-vx-fg focus:outline focus:outline-2 focus:outline-vx-accent';
export function CreatorWorkspace() {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [preview, setPreview] = useState(false);
  useEffect(() => { try { setPreview(localStorage.getItem('veyrnox_social_cinema') === 'true'); } catch {} }, []);
  if (!preview) return <p role="status" className="mt-8">The creator workspace is in preview and is not open yet.</p>;
  if (!account) return <div className="mt-8"><p className="mb-4">Sign in with your approved Cinema creator account.</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</Button></div>;
  return <Drafts key={account} />;
}
function Drafts() {
  const [path, setPath] = useState([]), [items, setItems] = useState([]);
  const [state, setState] = useState('loading'), [error, setError] = useState('');
  const [version, setVersion] = useState(0), [editor, setEditor] = useState(null), [notice, setNotice] = useState('');
  const parent = path.at(-1), parentId = parent?.id;
  useEffect(() => {
    let active = true;
    setState('loading'); setItems([]); setError('');
    gatewayFetch(`/cinema/content${parentId ? `?parent_id=${encodeURIComponent(parentId)}` : ''}`).then(data => {
      if (active) { setItems(data.content); setState('ready'); }
    }).catch(e => { if (active) { setError(message(e.code)); setState('error'); } });
    return () => { active = false; };
  }, [parentId, version]);
  function navigate(next) { setEditor(null); setNotice(''); setPath(next); }
  const types = parent ? [parent.content_type === 'SERIES' ? 'SEASON' : 'EPISODE'] : ['SERIES','FILM','SHORT','TRAILER'];
  return <section className="mt-10 border-t border-vx-border pt-6" aria-labelledby="drafts-title">
    <nav aria-label="Draft location" className="flex flex-wrap gap-2 text-sm">
      <button type="button" onClick={() => navigate([])} className="rounded px-2 py-2 text-vx-accent focus-visible:outline-vx-accent">All projects</button>
      {path.map((item, i) => <button key={item.id} type="button" onClick={() => navigate(path.slice(0, i + 1))} className="max-w-full break-words rounded px-2 py-2 text-vx-accent focus-visible:outline-vx-accent">/ {item.title}</button>)}
    </nav>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <h2 id="drafts-title" className="text-2xl font-bold">{parent ? `${labels[types[0]]} drafts` : 'Your projects'}</h2>
      {state === 'ready' && !editor && <Button onClick={() => { setNotice(''); setEditor({ content_type: types[0], parent_id: parentId || null, position: parent ? Math.max(0, ...items.map(i => i.position)) + 1 : null, title: '', synopsis: '', language: parent?.language || 'en', ai_disclosures: [] }); }}>New {parent ? labels[types[0]].toLowerCase() : 'project'}</Button>}
    </div>
    {notice && <p role="status" className="mt-4 text-vx-accent">{notice}</p>}
    {state === 'loading' ? <p role="status" className="mt-6">Loading your drafts…</p> : state === 'error' ? <div className="mt-6"><p role="alert">{error}</p><Button variant="ghost" className="mt-4" onClick={() => setVersion(n => n + 1)}>Try again</Button></div> : <>
      {editor ? <DraftEditor key={`${editor.id || 'new'}:${editor.revision || 0}`} draft={editor} types={types} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice('Draft saved privately.'); setVersion(n => n + 1); }} onReload={() => { setEditor(null); setVersion(n => n + 1); }} /> : items.length ? <ul className="mt-6 divide-y divide-vx-border border-y border-vx-border">
        {items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="min-w-0 flex-1"><p className="text-xs font-vx-mono text-vx-fg-muted">{labels[item.content_type]}{item.position ? ` ${item.position}` : ''} · Private draft</p><h3 className="mt-2 break-words font-bold">{item.title}</h3><p className="mt-2 line-clamp-2 break-words text-sm text-vx-fg-body">{item.synopsis || 'No synopsis yet.'}</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => setEditor(item)} aria-label={`Edit ${item.title}`}>Edit</Button>{['SERIES','SEASON'].includes(item.content_type) && <Button variant="ghost" size="sm" onClick={() => navigate([...path, item])}>Open {item.content_type === 'SERIES' ? 'seasons' : 'episodes'}</Button>}</div>
        </li>)}
      </ul> : <div className="py-10"><h3 className="font-bold">{parent ? `Add your first ${labels[types[0]].toLowerCase()}.` : 'Start with a story.'}</h3><p className="mt-3 text-vx-fg-muted">{parent ? 'Give it a title and synopsis. You can keep shaping it before uploads open.' : 'Create a series with seasons and episodes, or develop a standalone film, short or trailer.'}</p></div>}
    </>}
  </section>;
}
function DraftEditor({ draft, types, onCancel, onSaved, onReload }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef(null);
  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ ...(draft.id ? { id: draft.id, revision: draft.revision } : {}),
      content_type: draft.id ? draft.content_type : form.get('content_type'), parent_id: draft.parent_id,
      position: draft.parent_id ? (draft.id ? draft.position : Number(form.get('position'))) : null,
      title: form.get('title').trim(), synopsis: form.get('synopsis'), language: form.get('language').trim(), ai_disclosures: form.getAll('ai_disclosures') });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await gatewayFetch('/cinema/content', { method: draft.id ? 'PATCH' : 'POST', body, headers: { 'idempotency-key': attempt.current.key } }); onSaved(); }
    catch(e) { setError(e.code || 'temporarily_unavailable'); setBusy(false); }
  }
  return <form onSubmit={save} className="mt-6 max-w-2xl space-y-5">
    <fieldset disabled={busy} className="space-y-5">
      <legend className="mb-4 font-bold">{draft.id ? `Edit ${labels[draft.content_type].toLowerCase()}` : 'New draft'}</legend>
      {!draft.id && <label className="block text-sm font-semibold" htmlFor="draft-type">Type<select id="draft-type" name="content_type" defaultValue={draft.content_type} className={input}>{types.map(t => <option key={t} value={t}>{labels[t]}</option>)}</select></label>}
      {draft.parent_id && !draft.id && <label className="block text-sm font-semibold" htmlFor="draft-position">{labels[draft.content_type]} number<input id="draft-position" name="position" type="number" min={1} max={10000} step={1} required defaultValue={draft.position} className={input} /></label>}
      <label className="block text-sm font-semibold" htmlFor="draft-title">Title<input id="draft-title" name="title" required maxLength={160} defaultValue={draft.title} className={input} /></label>
      <label className="block text-sm font-semibold" htmlFor="draft-synopsis">Synopsis<textarea id="draft-synopsis" name="synopsis" rows={5} maxLength={2000} defaultValue={draft.synopsis} className={input} /></label>
      <label className="block text-sm font-semibold" htmlFor="draft-language">Language code<input id="draft-language" name="language" required pattern="[a-z]{2,3}(-[A-Z]{2})?" maxLength={6} defaultValue={draft.language} className={input} aria-describedby="language-help" /></label>
      <p id="language-help" className="text-xs text-vx-fg-muted">For example: en (English), fr (French), or pt-BR (Brazilian Portuguese).</p>
      <fieldset><legend className="font-semibold">AI disclosures</legend><p className="mt-2 text-sm text-vx-fg-muted">Select what you plan to use. These draft declarations do not clear rights or approve publication.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{AI_DISCLOSURES.map(value => <label key={value} className="flex items-start gap-3 text-sm"><input type="checkbox" name="ai_disclosures" value={value} defaultChecked={draft.ai_disclosures.includes(value)} className="mt-1 accent-vx-accent" />{disclosureLabels[value]}</label>)}</div></fieldset>
    </fieldset>
    {error && <div role="alert"><p>{message(error)}</p>{error === 'revision_conflict' && <Button variant="ghost" className="mt-3" type="button" onClick={onReload}>Discard these edits and reload</Button>}</div>}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save private draft'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form>;
}
function message(code) {
  return ({ content_not_open: 'Draft creation is not open yet. Please check back soon.', creator_required: 'An approved Cinema creator account is required. Apply from your Social Cinema profile.', account_not_active: 'Your Cinema account cannot manage drafts right now. Contact support.', revision_conflict: 'This draft changed in another session. Copy any edits you want to keep, then reload the latest version.', position_taken: 'That number is already in use. Choose another.', draft_limit_reached: 'You have reached the preview draft limit. Contact support.', invalid_draft: 'Check the title, language and other fields, then try again.', rate_limited: 'Too many requests. Wait a minute and try again.', content_not_found: 'That draft is no longer available to your account.', idempotency_conflict: 'This save attempt changed. Reload your drafts before trying again.' })[code] || 'We could not load or save your drafts. Please try again.';
}
