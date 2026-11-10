'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient.js';
import {
  AUDIO_REFERENCE_PURPOSES,
  MAX_SIGNATURE_VOICE_RECIPES,
  readAudioVoiceRecipes,
  readSignatureVoiceRecipeIds,
  toggleSignatureVoiceRecipe,
} from '../_lib/audioReferenceShelf';
import { voiceRecipeSummary } from '../_lib/voicePalettes';

const currentAccount = () => getStoredUserId() || '';
const serverAccount = () => '';
const purposeLabel = (id) => AUDIO_REFERENCE_PURPOSES.find(([value]) => value === id)?.[1] || 'Audio reference';

export function VoiceRecipeLibrary({ onApply, title = 'My Voice Recipes' }) {
  const accountId = useSyncExternalStore(onSessionChange, currentAccount, serverAccount);
  const [recipes, setRecipes] = useState([]);
  const [signatureIds, setSignatureIds] = useState([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecipes(readAudioVoiceRecipes(window.localStorage, accountId));
      setSignatureIds(readSignatureVoiceRecipeIds(window.localStorage, accountId));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId]);

  return <details open className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm font-extrabold text-vx-fg">
      <span>{title}</span><span className="vx-num text-xs text-vx-fg-muted">{recipes.length} · Signature {signatureIds.length}/{MAX_SIGNATURE_VOICE_RECIPES}</span>
    </summary>
    <p className="mt-1 max-w-2xl text-[11px] leading-5 text-vx-fg-muted">Reuse the validated stock voice and delivery controls saved with your own Audio Shelf results. Applying a recipe changes settings only; it never restores a script, plays audio, generates media or spends credits.</p>
    {!accountId ? <p className="mt-3 text-xs text-vx-fg-muted">Sign in to see Voice Recipes saved for this account in this browser.</p>
      : recipes.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="My Voice Recipes">
        {[...recipes].sort((a, b) => Number(signatureIds.includes(b.id)) - Number(signatureIds.includes(a.id))).map((item) => {
          const signature = signatureIds.includes(item.id);
          const setFull = !signature && signatureIds.length >= MAX_SIGNATURE_VOICE_RECIPES;
          return <li key={item.id} className={`flex min-h-24 items-stretch overflow-hidden rounded-xl border bg-vx-base ${signature ? 'border-vx-accent/50' : 'border-vx-border'}`}>
          <div className="min-w-0 flex-1 p-3">
            <div className="flex items-center gap-2"><p className="truncate text-sm font-extrabold text-vx-fg">{item.name}</p>{signature&&<span className="shrink-0 rounded-full border border-vx-accent/40 px-2 py-0.5 font-vx-mono text-[8px] font-bold uppercase tracking-[0.08em] text-vx-accent">Signature</span>}</div>
            <p className="mt-1 text-[11px] leading-4 text-vx-fg-muted">{voiceRecipeSummary(item.voiceRecipe)}</p>
            <p className="mt-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-fg-faint">{purposeLabel(item.purpose)} · Audio Shelf</p>
          </div>
          <div className="grid w-24 shrink-0 grid-rows-2 border-l border-vx-border">
            <button type="button" disabled={setFull} aria-pressed={signature} aria-label={`${signature ? 'Unpin' : 'Pin'} ${item.name} ${signature ? 'from' : 'to'} Signature Voice Set`} onClick={() => setSignatureIds(toggleSignatureVoiceRecipe(window.localStorage, accountId, item.id))} className="border-b border-vx-border px-2 text-[10px] font-extrabold text-vx-fg-muted hover:bg-vx-accent/[0.08] hover:text-vx-accent disabled:cursor-not-allowed disabled:opacity-35">{signature ? 'Unpin' : setFull ? 'Set full' : 'Pin signature'}</button>
            <button type="button" onClick={() => onApply(item.voiceRecipe, item.name)} className="px-2 text-xs font-extrabold text-vx-accent hover:bg-vx-accent/[0.08]">Apply</button>
          </div>
        </li>})}
      </ul>
        : <p className="mt-3 rounded-xl border border-dashed border-vx-border px-4 py-5 text-center text-xs leading-5 text-vx-fg-muted">No saved recipes yet. Generate stock speech or an Audition Board take, then save it to Audio Shelf.</p>}
    <p className="mt-3 text-[10px] leading-4 text-vx-fg-faint">Pin up to three recurring deliveries as your Signature Voice Set. Recipes and pins are account-scoped browser metadata containing supported stock settings only—not voice samples, scripts, embeddings or cloned identities.</p>
  </details>;
}
