'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUserId, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway';
import {
  AUDIO_REFERENCE_PURPOSES,
  AUDIO_REFERENCE_TRAITS,
  MAX_AUDIO_COMPARISON,
  MAX_AUDIO_LISTENING_SETS,
  MAX_PINNED_AUDIO_REFERENCES,
  MAX_AUDIO_REFERENCE_TRAITS,
  auditOwnedAudioReferences,
  audioEngineFit,
  createAudioShelfManifest,
  fetchOwnedAudioReference,
  filterAudioReferences,
  importOwnedAudioShelfManifest,
  loadOwnedAudioComparison,
  readAudioDuration,
  readAudioListeningSets,
  readAudioReferenceShelf,
  readPinnedAudioReferenceIds,
  removeAudioReference,
  removeAudioListeningSet,
  saveAudioReference,
  saveAudioListeningSet,
  sortAudioReferences,
  toggleAudioComparison,
  togglePinnedAudioReference,
  updateAudioReferenceMetadata,
} from '../_lib/audioReferenceShelf';
import { stageVoiceRecipeHandoff, voiceRecipeSummary } from '../_lib/voicePalettes';

const purposeLabel = (id) => AUDIO_REFERENCE_PURPOSES.find(([value]) => value === id)?.[1] || 'Audio reference';
const currentAccount = () => getStoredUserId() || '';
const serverAccount = () => '';

export function AudioReferenceShelf({ audio, disabled, onUse }) {
  const router = useRouter();
  const accountId = useSyncExternalStore(onSessionChange, currentAccount, serverAccount);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [fit, setFit] = useState(null);
  const [query, setQuery] = useState('');
  const [purpose, setPurpose] = useState('all');
  const [voiceRecipesOnly, setVoiceRecipesOnly] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [comparison, setComparison] = useState([]);
  const [compareBusy, setCompareBusy] = useState(false);
  const [manifestBusy, setManifestBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [health, setHealth] = useState({});
  const [healthFilter, setHealthFilter] = useState('all');
  const [editingId, setEditingId] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [pinnedIds, setPinnedIds] = useState([]);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [trait, setTrait] = useState('all');
  const [listeningSets, setListeningSets] = useState([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setItems(readAudioReferenceShelf(window.localStorage, accountId));
      setCompareIds([]);
      setComparison([]);
      setHealth({});
      setHealthFilter('all');
      setEditingId('');
      setSortBy('recent');
      setPinnedIds(readPinnedAudioReferenceIds(window.localStorage, accountId));
      setPinnedOnly(false);
      setTrait('all');
      setListeningSets(readAudioListeningSets(window.localStorage, accountId));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId]);

  function saveCurrent(event) {
    event.preventDefault();
    if (!audio?.jobId || !accountId) return;
    const data = new FormData(event.currentTarget);
    setItems(saveAudioReference(window.localStorage, accountId, {
      jobId: audio.jobId,
      name: data.get('name'),
      purpose: data.get('purpose'),
    }));
    setNotice('Saved to this account’s Audio Reference Shelf in this browser.');
  }

  async function activateReference(item) {
    setBusy(item.id);
    setNotice('');
    setFit(null);
    try {
      const owned = await fetchOwnedAudioReference(gatewayFetch, item.jobId);
      setHealth((current) => ({ ...current, [item.id]: 'available' }));
      let duration = null;
      try { duration = await readAudioDuration(owned.url); } catch { /* the server remains authoritative */ }
      onUse({ ...owned, label: item.name, ...(duration ? { duration } : {}) });
      setFit({ itemId: item.id, duration, engines: audioEngineFit(duration) });
      setNotice(duration
        ? `${item.name} is ready. Its ${durationLabel(duration)} length was checked against the current lip-sync engines.`
        : `${item.name} is ready, but its length could not be read. Check the source before generating; the server will still enforce the real limit.`);
      return true;
    } catch {
      setHealth((current) => ({ ...current, [item.id]: 'unavailable' }));
      setNotice(`${item.name} is no longer available as owned audio. Remove it or try again later.`);
      return false;
    } finally {
      setBusy('');
    }
  }

  function reuseVoiceRecipe(item) {
    if (!stageVoiceRecipeHandoff(window.sessionStorage, accountId, item.name, item.voiceRecipe)) {
      setNotice('This Voice Recipe could not be opened. Try saving the audio again from Text to Speech Studio.');
      return;
    }
    router.push('/app/text-to-speech');
  }

  function toggleCompare(itemId) {
    setCompareIds((current) => toggleAudioComparison(current, itemId));
    setComparison([]);
  }

  async function loadComparison() {
    if (!compareIds.length || compareBusy) return;
    setCompareBusy(true);
    const selected = compareIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);
    const rows = await loadOwnedAudioComparison(gatewayFetch, selected);
    if ((getStoredUserId() || '') !== accountId) {
      setCompareBusy(false);
      return;
    }
    setComparison(rows);
    setCompareBusy(false);
    const available = rows.filter((row) => row.available).length;
    const measured = rows.filter((row) => row.duration).length;
    setNotice(`${available} of ${rows.length} selected reference${rows.length === 1 ? '' : 's'} ready for listening; ${measured} timing profile${measured === 1 ? '' : 's'} measured. Fresh links and durations stay in memory only.`);
  }

  function exportManifest() {
    const manifest = createAudioShelfManifest(window.localStorage, accountId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `veyrnox-audio-shelf-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Audio Shelf manifest exported. It contains metadata only—never audio bytes, signed links, scripts or credentials.');
  }

  async function importManifest(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || manifestBusy) return;
    if (file.size > 262144) {
      setNotice('That manifest is too large. Choose a Veyrnox Audio Shelf JSON file under 256 KB.');
      return;
    }
    setManifestBusy(true);
    const importAccount = accountId;
    try {
      const parsed = JSON.parse(await file.text());
      const result = await importOwnedAudioShelfManifest(gatewayFetch, window.localStorage, importAccount, parsed);
      if ((getStoredUserId() || '') !== importAccount) return;
      setItems(result.items);
      setCompareIds([]);
      setComparison([]);
      setHealth({});
      setHealthFilter('all');
      setSortBy('recent');
      setPinnedIds(result.pins);
      setPinnedOnly(false);
      setTrait('all');
      setListeningSets(result.listeningSets);
      setNotice(`Imported ${result.imported} owned reference${result.imported === 1 ? '' : 's'}. ${result.existing} already existed, ${result.unavailable} could not be revalidated, ${result.capacitySkipped} exceeded shelf capacity, and ${result.rejected} invalid entr${result.rejected === 1 ? 'y was' : 'ies were'} ignored.`);
    } catch {
      setNotice('That file is not a valid Veyrnox Audio Shelf manifest. Nothing was imported.');
    } finally {
      setManifestBusy(false);
    }
  }

  async function checkShelfHealth() {
    if (!accountId || !items.length || healthBusy) return;
    setHealthBusy(true);
    const auditAccount = accountId;
    const results = await auditOwnedAudioReferences(gatewayFetch, items);
    if ((getStoredUserId() || '') !== auditAccount) {
      setHealthBusy(false);
      return;
    }
    setHealth(Object.fromEntries(results.map((row) => [row.itemId, row.status])));
    setHealthBusy(false);
    const unavailable = results.filter((row) => row.status === 'unavailable').length;
    setNotice(unavailable
      ? `${results.length - unavailable} reference${results.length - unavailable === 1 ? '' : 's'} available; ${unavailable} need review. Nothing was removed.`
      : `All ${results.length} saved references are currently available as owned audio. No media was changed.`);
  }

  function updateReference(event, item) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = updateAudioReferenceMetadata(window.localStorage, accountId, item.id, {
      name: data.get('name'),
      purpose: data.get('purpose'),
      traits: data.getAll('traits'),
    });
    const updated = next.find((candidate) => candidate.id === item.id);
    if (!updated || (updated.name === item.name && updated.purpose === item.purpose && JSON.stringify(updated.traits || []) === JSON.stringify(item.traits || []))) {
      setNotice('Enter a name and choose a valid production purpose. Nothing was changed.');
      return;
    }
    setItems(next);
    setEditingId('');
    setNotice('Shelf label updated in this browser. The Library asset, audio and Voice Recipe were not changed.');
  }

  function toggleCuePin(itemId) {
    const next = togglePinnedAudioReference(window.localStorage, accountId, itemId);
    setPinnedIds(next);
    setNotice(next.includes(itemId)
      ? `Cue Pin saved in this browser (${next.length}/${MAX_PINNED_AUDIO_REFERENCES}).`
      : 'Cue Pin removed. The Audio Shelf reference and Library asset were not changed.');
  }

  function saveCurrentListeningSet(event) {
    event.preventDefault();
    if (compareIds.length < 2) return;
    const data = new FormData(event.currentTarget);
    const before = listeningSets.length;
    const next = saveAudioListeningSet(window.localStorage, accountId, {
      name: data.get('name'),
      itemIds: compareIds,
    });
    setListeningSets(next);
    if (next.length === before) {
      setNotice(`Use a unique Listening Set name. Up to ${MAX_AUDIO_LISTENING_SETS} sets can be saved in this browser.`);
      return;
    }
    event.currentTarget.reset();
    setNotice(`Listening Set saved with ${compareIds.length} references. Audio remains unloaded until you request a fresh check.`);
  }

  function openListeningSet(set) {
    setCompareIds(set.itemIds);
    setComparison([]);
    setNotice(`${set.name} is open in the Listening Board. Load fresh audio when you are ready to compare.`);
  }

  const visibleItems = sortAudioReferences(
    filterAudioReferences(items, { query, purpose, trait, voiceRecipesOnly, pinnedOnly, pinnedIds, healthById: health, healthStatus: healthFilter }),
    { sortBy, healthById: health },
  );

  return <details open className="mt-4 rounded-xl border border-vx-border bg-vx-panel p-4">
    <summary className="cursor-pointer text-sm font-extrabold text-vx-fg">Audio Reference Shelf <span className="vx-num text-vx-fg-muted">{items.length}/24</span></summary>
    <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted">Organise owned finished audio for reuse in lip-sync workflows. This account-scoped browser shelf stores only a Library job ID, name, purpose and optional stock Voice Recipe—never audio bytes, signed links, scripts, reusable consent, voiceprints or cloned identities.</p>
    {!accountId&&<p className="mt-3 text-xs text-vx-fg-muted">Sign in to save or reopen owned audio references.</p>}
    {accountId&&<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!items.length||manifestBusy} onClick={exportManifest} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted disabled:opacity-40">Export shelf manifest</button><label className={`cursor-pointer rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted ${manifestBusy?'pointer-events-none opacity-40':''}`}>{manifestBusy?'Revalidating imported audio…':'Import shelf manifest'}<input type="file" accept="application/json,.json" className="sr-only" disabled={manifestBusy} onChange={importManifest}/></label><button type="button" disabled={!items.length||manifestBusy||healthBusy} onClick={checkShelfHealth} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted disabled:opacity-40">{healthBusy?'Checking shelf health…':'Check shelf health'}</button><p className="basis-full text-[10px] leading-4 text-vx-fg-faint">Portable metadata only. Import and health checks revalidate audio jobs against the current account without generating or deleting media.</p></div>}
    {audio?.jobId&&accountId&&<form key={audio.jobId} onSubmit={saveCurrent} className="mt-3 grid gap-2 rounded-lg border border-vx-border bg-vx-base p-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_auto]">
      <input name="name" aria-label="Audio reference name" required maxLength={64} defaultValue={audio.name || 'Owned audio reference'} className="rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg"/>
      <select name="purpose" aria-label="Audio reference purpose" defaultValue="lip-sync-dialogue" className="rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg">
        {AUDIO_REFERENCE_PURPOSES.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
      <button type="submit" disabled={disabled} className="rounded-lg border border-vx-accent px-3 py-2 text-xs font-bold text-vx-accent disabled:opacity-40">Save reference</button>
    </form>}
    {items.length>0&&<div className="mt-3 grid gap-2 rounded-xl border border-vx-border bg-vx-base p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-label="Audio Shelf Finder">
      <label><span className="sr-only">Search Audio Shelf</span><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search names or purposes" aria-label="Search Audio Shelf" className="min-h-10 w-full rounded-lg border border-vx-border bg-vx-panel px-3 text-xs text-vx-fg"/></label>
      <select value={purpose} onChange={(event)=>setPurpose(event.target.value)} aria-label="Filter Audio Shelf by purpose" className="min-h-10 rounded-lg border border-vx-border bg-vx-panel px-3 text-xs text-vx-fg"><option value="all">All production purposes</option>{AUDIO_REFERENCE_PURPOSES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <select value={trait} onChange={(event)=>setTrait(event.target.value)} aria-label="Filter Audio Shelf by Cue Tag" className="min-h-10 rounded-lg border border-vx-border bg-vx-panel px-3 text-xs text-vx-fg"><option value="all">All Cue Tags</option>{AUDIO_REFERENCE_TRAITS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <select value={healthFilter} onChange={(event)=>setHealthFilter(event.target.value)} aria-label="Filter Audio Shelf by health" className="min-h-10 rounded-lg border border-vx-border bg-vx-panel px-3 text-xs text-vx-fg"><option value="all">All health states</option><option value="available">Available</option><option value="unavailable">Needs review</option><option value="unchecked">Not checked</option></select>
      <select value={sortBy} onChange={(event)=>setSortBy(event.target.value)} aria-label="Sort Audio Shelf" className="min-h-10 rounded-lg border border-vx-border bg-vx-panel px-3 text-xs text-vx-fg"><option value="recent">Recently saved</option><option value="name">Name A–Z</option><option value="purpose">Production purpose</option><option value="health">Review priority</option></select>
      <button type="button" aria-pressed={voiceRecipesOnly} onClick={()=>setVoiceRecipesOnly((value)=>!value)} className="min-h-10 rounded-lg border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:text-vx-accent">Voice Recipes only</button>
      <button type="button" aria-pressed={pinnedOnly} onClick={()=>setPinnedOnly((value)=>!value)} className="min-h-10 rounded-lg border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:text-vx-accent">Cue Pins only · {pinnedIds.length}/{MAX_PINNED_AUDIO_REFERENCES}</button>
      <p className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-fg-faint sm:col-span-2 lg:col-span-4 xl:col-span-7">Showing {visibleItems.length} of {items.length} saved references</p>
    </div>}
    {(listeningSets.length>0||compareIds.length>=2)&&<section className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3" aria-labelledby="listening-sets-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-accent">Personal comparison groups</p><h3 id="listening-sets-title" className="mt-1 text-sm font-extrabold">Listening Sets · {listeningSets.length}/{MAX_AUDIO_LISTENING_SETS}</h3></div>{compareIds.length>=2&&<form onSubmit={saveCurrentListeningSet} className="flex flex-wrap gap-2"><input name="name" required maxLength={40} aria-label="Listening Set name" placeholder="Name this comparison" className="rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg"/><button type="submit" disabled={listeningSets.length>=MAX_AUDIO_LISTENING_SETS} className="rounded-lg border border-vx-accent px-3 py-2 text-xs font-bold text-vx-accent disabled:opacity-40">Save current board</button></form>}</div>
      <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted">Save two or three shelf references as a reusable comparison group. Sets store IDs only; opening one never loads audio, submits a job or spends credits.</p>
      {listeningSets.length>0&&<ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Saved Listening Sets">{listeningSets.map((set)=><li key={set.id} className="rounded-lg border border-vx-border p-3"><p className="truncate text-xs font-extrabold text-vx-fg">{set.name}</p><p className="mt-1 text-[10px] text-vx-fg-muted">{set.itemIds.length} owned references</p><div className="mt-2 flex gap-2"><button type="button" onClick={()=>openListeningSet(set)} className="rounded-lg border border-vx-accent px-3 py-2 text-xs font-bold text-vx-accent">Open in board</button><button type="button" onClick={()=>{setListeningSets(removeAudioListeningSet(window.localStorage,accountId,set.id));setNotice('Listening Set removed. Audio Shelf references and Library assets were not changed.');}} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-danger">Remove set</button></div></li>)}</ul>}
    </section>}
    {compareIds.length>0&&<section className="mt-3 rounded-xl border border-vx-accent/35 bg-vx-accent/[0.04] p-3" aria-labelledby="reference-listening-board-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-accent">No-credit comparison</p><h3 id="reference-listening-board-title" className="mt-1 text-sm font-extrabold">Reference Listening Board · {compareIds.length}/{MAX_AUDIO_COMPARISON}</h3></div><div className="flex flex-wrap gap-2"><button type="button" disabled={compareBusy} onClick={loadComparison} className="rounded-lg bg-vx-accent px-3 py-2 text-xs font-extrabold text-vx-accent-ink disabled:opacity-40">{compareBusy?'Checking owned audio…':'Load fresh audio'}</button><button type="button" disabled={compareBusy} onClick={()=>{setCompareIds([]);setComparison([]);}} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted disabled:opacity-40">Clear</button></div></div>
      <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted">Compare existing owned performances by ear. This board does not identify speakers, score similarity, clone voices or generate media.</p>
      <div className="mt-3 flex flex-wrap gap-2">{compareIds.map((id)=><span key={id} className="rounded-full border border-vx-border px-2 py-1 text-[10px] font-bold text-vx-fg-muted">{items.find((item)=>item.id===id)?.name||'Saved reference'}</span>)}</div>
      {comparison.length>0&&<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Fresh owned audio comparison">{comparison.map((row)=>{
        const item = items.find((candidate)=>candidate.id===row.itemId);
        const selected = Boolean(item&&audio?.jobId===item.jobId);
        return <article key={row.itemId} className={`rounded-lg border bg-vx-base p-3 ${selected?'border-vx-accent':'border-vx-border'}`}><p className="truncate text-xs font-extrabold text-vx-fg">{row.name}</p>{row.available?<><audio controls preload="metadata" src={row.url} className="mt-2 w-full"/>{row.duration?<div className="mt-2" aria-label="Comparison timing fit"><p className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-fg-muted">{durationLabel(row.duration)} · live engine fit</p><div className="mt-1 flex flex-wrap gap-1">{row.engines.map((engine)=><span key={engine.id} className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${engine.fits?'border-vx-accent/40 text-vx-accent':'border-vx-border text-vx-fg-faint'}`}>{engine.fits?'Fits':`Shorten ${durationLabel(engine.overBy)}`} · {engine.label}</span>)}</div></div>:<p className="mt-2 text-[10px] font-bold text-vx-fg-muted">Timing unavailable · server limit still applies</p>}<button type="button" disabled={disabled||Boolean(busy)||selected||!item} onClick={()=>item&&activateReference(item)} className="mt-2 w-full rounded-lg border border-vx-accent px-3 py-2 text-xs font-extrabold text-vx-accent disabled:opacity-45">{selected?'Selected for performance':busy===row.itemId?'Checking duration…':'Use for this performance'}</button></>:<p className="mt-2 text-[11px] leading-4 text-vx-danger">This owned audio is unavailable. Remove it from the board or retry later.</p>}</article>})}</div>}
    </section>}
    {items.length>0&&visibleItems.length>0?<ul className="mt-3 space-y-2" aria-label="Saved audio references">
      {visibleItems.map(item=><li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-vx-border bg-vx-base p-3">
        <div className="min-w-0 flex-1">{editingId===item.id?<form onSubmit={(event)=>updateReference(event,item)} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,.7fr)_auto_auto]" aria-label={`Edit ${item.name}`}>
          <input name="name" aria-label="Edit audio reference name" required maxLength={64} defaultValue={item.name} className="rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg"/>
          <select name="purpose" aria-label="Edit audio reference purpose" defaultValue={item.purpose} className="rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg">{AUDIO_REFERENCE_PURPOSES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
          <button type="submit" className="rounded-lg border border-vx-accent px-3 py-2 text-xs font-bold text-vx-accent">Save label</button>
          <button type="button" onClick={()=>setEditingId('')} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted">Cancel</button>
          <fieldset className="sm:col-span-4"><legend className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-fg-faint">Cue Tags · choose up to {MAX_AUDIO_REFERENCE_TRAITS}</legend><div className="mt-2 flex flex-wrap gap-2">{AUDIO_REFERENCE_TRAITS.map(([value,label])=><label key={value} className="flex items-center gap-1.5 rounded-full border border-vx-border px-2 py-1 text-[10px] font-bold text-vx-fg-muted"><input type="checkbox" name="traits" value={value} defaultChecked={item.traits?.includes(value)}/>{label}</label>)}</div></fieldset>
        </form>:<><div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-extrabold text-vx-fg">{item.name}</p>{pinnedIds.includes(item.id)&&<span className="rounded-full border border-vx-accent/40 px-2 py-0.5 font-vx-mono text-[8px] font-bold uppercase tracking-[0.08em] text-vx-accent">Cue Pin</span>}{health[item.id]&&<span className={`rounded-full border px-2 py-0.5 font-vx-mono text-[8px] font-bold uppercase tracking-[0.08em] ${health[item.id]==='available'?'border-vx-accent/40 text-vx-accent':'border-vx-danger/40 text-vx-danger'}`}>{health[item.id]==='available'?'Available':'Needs review'}</span>}</div><p className="mt-1 text-[10px] text-vx-fg-muted">{purposeLabel(item.purpose)} · owned Library audio</p>{item.traits?.length>0&&<div className="mt-1 flex flex-wrap gap-1" aria-label="Cue Tags">{item.traits.map((id)=><span key={id} className="rounded-full border border-vx-border px-2 py-0.5 text-[9px] font-bold text-vx-fg-muted">{AUDIO_REFERENCE_TRAITS.find(([value])=>value===id)?.[1]}</span>)}</div>}
          {item.voiceRecipe&&<p className="mt-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.06em] text-vx-accent">Voice Recipe · {voiceRecipeSummary(item.voiceRecipe)}</p>}
          {fit?.itemId===item.id&&<div className="mt-2" aria-label="Audio engine fit">
            {fit.duration?<><p className="font-vx-mono text-[10px] font-bold text-vx-fg">{durationLabel(fit.duration)} measured</p><ul className="mt-1 flex flex-wrap gap-1.5">{fit.engines.map(engine=><li key={engine.id} className={`rounded-full border px-2 py-1 text-[9px] font-bold ${engine.fits?'border-vx-accent/40 text-vx-accent':'border-vx-border text-vx-fg-muted'}`}>{engine.fits?'Fits':`Shorten ${durationLabel(engine.overBy)}`} · {engine.label} ({engine.maxSeconds}s)</li>)}</ul></>:<p className="text-[10px] font-bold text-vx-fg-muted">Length unknown · server check still required</p>}
          </div>}</>}
        </div>
        <button type="button" disabled={disabled||Boolean(busy)} onClick={()=>activateReference(item)} className="rounded-lg border border-vx-accent px-3 py-2 text-xs font-bold text-vx-accent disabled:opacity-40">{busy===item.id?'Checking…':'Use'}</button>
        <button type="button" aria-pressed={compareIds.includes(item.id)} disabled={disabled||Boolean(busy)||(!compareIds.includes(item.id)&&compareIds.length>=MAX_AUDIO_COMPARISON)} onClick={()=>toggleCompare(item.id)} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:text-vx-accent disabled:opacity-40">{compareIds.includes(item.id)?'Remove compare':'Compare'}</button>
        {item.voiceRecipe&&<button type="button" disabled={disabled||Boolean(busy)} onClick={()=>reuseVoiceRecipe(item)} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg disabled:opacity-40">Reuse Voice Recipe</button>}
        <button type="button" aria-pressed={pinnedIds.includes(item.id)} disabled={disabled||Boolean(busy)||(!pinnedIds.includes(item.id)&&pinnedIds.length>=MAX_PINNED_AUDIO_REFERENCES)} onClick={()=>toggleCuePin(item.id)} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:text-vx-accent disabled:opacity-40">{pinnedIds.includes(item.id)?'Unpin cue':'Pin cue'}</button>
        <button type="button" disabled={disabled||Boolean(busy)||editingId===item.id} onClick={()=>setEditingId(item.id)} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-fg-muted disabled:opacity-40">Edit label</button>
        <button type="button" disabled={disabled||Boolean(busy)} onClick={()=>{setItems(removeAudioReference(window.localStorage,accountId,item.id));setPinnedIds((current)=>current.filter((id)=>id!==item.id));setListeningSets(readAudioListeningSets(window.localStorage,accountId));setCompareIds((current)=>current.filter((id)=>id!==item.id));setComparison([]);setHealth((current)=>{const next={...current};delete next[item.id];return next;});setNotice('Audio reference removed from this browser. The Library asset was not deleted.');}} className="rounded-lg border border-vx-border px-3 py-2 text-xs font-bold text-vx-danger disabled:opacity-40">Remove</button>
      </li>)}
    </ul>:items.length>0?<p className="mt-3 rounded-xl border border-dashed border-vx-border px-4 py-5 text-center text-xs text-vx-fg-muted">No saved references match these Shelf Finder filters.</p>:accountId&&<p className="mt-3 text-xs text-vx-fg-muted">Choose finished audio from Library, then save it here with a clear production purpose.</p>}
    {notice&&<p role="status" className="mt-3 text-xs text-vx-fg-muted">{notice}</p>}
  </details>;
}

function durationLabel(seconds) {
  return `${Math.round(Number(seconds) * 10) / 10}s`;
}
