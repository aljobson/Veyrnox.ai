'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  CHARACTER_TABS,
  CHARACTER_GROUPS,
  ODDLING_ARCHETYPES,
  ODDLING_SHOWS,
  ODDLING_TONES,
  readOddlingDraft,
  readOddlingPassport,
  writeOddlingDraft,
} from '../_lib/character';

const pill = (on) => `font-vx-mono text-[10px] font-bold rounded-full px-3 py-1.5 border transition-colors ${
  on ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg hover:border-vx-fg/30'}`;

const MUTABLE_GROUPS = new Set([
  'character_type', 'eye_color', 'eyes_type', 'eyes_details', 'mouth', 'ears', 'horns',
  'face_skin_material', 'face_surface_pattern', 'hair', 'accessories', 'rendering_style',
]);

function readableTime(timestamp) {
  try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(timestamp); }
  catch { return 'this browser'; }
}

// Oddlings are fictional creators with a repeatable visual canon and show format.
// This still only composes the prompt; Create owns pricing, consent and generation.
export function CharacterPanel({ enabled, onToggle, picks, onChange }) {
  const [tab, setTab] = useState(CHARACTER_TABS[0]);
  const [saved, setSaved] = useState(null);
  const [notice, setNotice] = useState('');
  const [starterKind, setStarterKind] = useState('human');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = readOddlingDraft(window.localStorage);
      setSaved(draft);
      const passport = readOddlingPassport(window.localStorage, window.location.search);
      if (passport) {
        onChange(passport.picks);
        onToggle(true);
        setStarterKind(passport.picks.character_type === 'Human' ? 'human' : 'creature');
        setNotice(`${passport.picks.oddling_name || 'Oddling'} passport loaded and active. Current model pricing is shown below.`);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onChange, onToggle]);

  function setPick(key, value) {
    const next = { ...picks };
    if (value) next[key] = value; else delete next[key];
    onChange(next);
    setNotice('');
  }

  function mutateOne() {
    const groups = CHARACTER_GROUPS.filter((group) => MUTABLE_GROUPS.has(group.id));
    const group = groups[Math.floor(Math.random() * groups.length)];
    const options = group.options.filter(([label]) => label !== picks[group.id]);
    setPick(group.id, options[Math.floor(Math.random() * options.length)][0]);
    setTab(group.tab);
    setNotice(`Mutated ${group.label.toLowerCase()}. Everything else stayed locked.`);
  }

  function save() {
    const savedAt = Date.now();
    if (writeOddlingDraft(window.localStorage, picks, savedAt)) {
      setSaved({ picks, savedAt });
      setNotice('Passport saved on this browser.');
    } else {
      setNotice('This browser blocked saving. Your current Oddling is still here.');
    }
  }

  const chosen = CHARACTER_GROUPS.flatMap((group) => picks[group.id] ? [picks[group.id]] : []);
  const named = picks.oddling_name || 'Untitled Oddling';
  const starters = ODDLING_ARCHETYPES.filter((oddling) => oddling.kind === starterKind);
  const isHuman = starterKind === 'human';
  const original = ODDLING_ARCHETYPES.find((item) => item.name === picks.oddling_name);

  return (
    <section className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel" aria-labelledby="vx-character-title">
      <div className="flex items-start justify-between gap-3 p-5">
        <div>
          <div className="flex items-center gap-2">
            <span id="vx-character-title" className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">ODDLING STUDIO</span>
            <span className="rounded-full bg-vx-fg/[0.06] px-2 py-0.5 font-vx-mono text-[8px] tracking-[0.12em] text-vx-fg-muted">FICTIONAL</span>
          </div>
          <h2 className="mt-1 text-lg font-extrabold">Make a creator nobody has met</h2>
          <p className="mt-1 max-w-[38ch] text-xs leading-relaxed text-vx-fg-muted">Go big: fat, muscular, bug-headed, enormous-haired—or another kind of being. Then lock the joke, look and recurring show.</p>
          <Link href="/app/oddlings" className="mt-2 inline-block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-accent hover:underline">OPEN FULL STUDIO →</Link>
        </div>
        <button id="vx-character-switch" aria-labelledby="vx-character-title vx-character-switch" onClick={() => onToggle(!enabled)} aria-pressed={enabled} className={pill(enabled)}>
          {enabled ? 'ON' : 'START'}
        </button>
      </div>

      {enabled && (
        <div className="border-t border-vx-border">
          {original && <figure className="relative border-b border-vx-border bg-vx-base">
            <Image
              src={`/oddlings/portraits/${original.id}.webp`}
              width={1024}
              height={1536}
              alt={`${original.name} original individual portrait`}
              className="h-72 w-full object-contain"
            />
            <figcaption className="absolute inset-x-2 bottom-2 rounded-lg bg-black/70 px-2.5 py-1.5 font-vx-mono text-[8px] tracking-[0.1em] text-white/80 backdrop-blur-sm">
              {original.name} · ORIGINAL REFERENCE PORTRAIT
            </figcaption>
          </figure>}

          <div className="space-y-5 p-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-fg-muted">START WITH A SIGNAL</span>
                <span className="font-vx-mono text-[9px] text-vx-fg-faint">{starters.length} STARTERS</span>
              </div>
              <div className="mb-2 flex gap-2" aria-label="Starter type">
                <button type="button" onClick={() => setStarterKind('human')} aria-pressed={isHuman} className={pill(isHuman)}>Human characters</button>
                <button type="button" onClick={() => setStarterKind('creature')} aria-pressed={!isHuman} className={pill(!isHuman)}>Other beings</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {starters.map((oddling) => (
                  <button
                    key={oddling.id}
                    type="button"
                    onClick={() => { onChange({ ...oddling.picks }); setStarterKind(oddling.kind); setNotice(`${oddling.name} loaded. Change anything.`); }}
                    aria-pressed={picks.oddling_name === oddling.name}
                    className={`rounded-xl border p-3 text-left transition-colors ${picks.oddling_name === oddling.name ? 'border-vx-accent bg-vx-accent/[0.07]' : 'border-vx-border bg-vx-base hover:border-vx-fg/30'}`}
                  >
                    <span className="block font-vx-mono text-[8px] font-bold tracking-[0.14em] text-vx-accent">{oddling.accent}</span>
                    <span className="mt-1 block text-sm font-bold">{oddling.name}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-vx-fg-muted">{oddling.hook}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <span className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-fg-muted">POINT OF VIEW</span>
              <label className="block">
                <span className="mb-1 block font-vx-mono text-[8px] tracking-[0.1em] text-vx-fg-faint">NAME</span>
                <input className="w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2 text-xs text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden" value={picks.oddling_name || ''} onChange={(event) => setPick('oddling_name', event.target.value)} maxLength={40} placeholder="Vera Static" />
              </label>
              <label className="block">
                <span className="mb-1 block font-vx-mono text-[8px] tracking-[0.1em] text-vx-fg-faint">WHY PEOPLE FOLLOW</span>
                <input className="w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2 text-xs text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden" value={picks.oddling_obsession || ''} onChange={(event) => setPick('oddling_obsession', event.target.value)} maxLength={140} placeholder="the private omens hiding in dead air" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block font-vx-mono text-[8px] tracking-[0.1em] text-vx-fg-faint">VOICE</span>
                  <select className="w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2 text-xs text-vx-fg focus:border-vx-accent focus:outline-hidden" value={picks.oddling_voice || ''} onChange={(event) => setPick('oddling_voice', event.target.value)}>
                    <option value="">Choose a voice</option>
                    {ODDLING_TONES.map(([label]) => <option key={label}>{label}</option>)}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block font-vx-mono text-[8px] tracking-[0.1em] text-vx-fg-faint">RECURRING SHOW</span>
                  <select className="w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2 text-xs text-vx-fg focus:border-vx-accent focus:outline-hidden" value={picks.oddling_show || ''} onChange={(event) => setPick('oddling_show', event.target.value)}>
                    <option value="">Choose a format</option>
                    {ODDLING_SHOWS.map(([label]) => <option key={label}>{label}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block font-vx-mono text-[8px] tracking-[0.1em] text-vx-fg-faint">NEVER DRIFT · VISUAL CANON</span>
                <input className="w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2 text-xs text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden" value={picks.oddling_rule || ''} onChange={(event) => setPick('oddling_rule', event.target.value)} maxLength={160} placeholder="sharp bob, translucent veil, vintage radio earpiece" />
              </label>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                {CHARACTER_TABS.map((item) => (
                  <button key={item} onClick={() => setTab(item)} aria-pressed={tab === item} className={pill(tab === item)}>{item}</button>
                ))}
                <span className="flex-1" />
                <button onClick={mutateOne} className={pill(false)}>Mutate one</button>
                <button onClick={() => { onChange({}); setNotice('Clean passport.'); }} className={pill(false)}>Reset</button>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-vx-fg-faint">Mutate one changes a styling trait. Body shape and size stay deliberate—pick them yourself in Body rather than turning real differences into random punchlines.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {CHARACTER_GROUPS.filter((group) => group.tab === tab).map((group) => (
                  <label key={group.id} className="flex flex-col gap-1">
                    <span className="font-vx-mono text-[8px] tracking-[0.1em] text-vx-fg-faint uppercase">{group.label}</span>
                    <select
                      value={picks[group.id] || ''}
                      onChange={(event) => {
                        setPick(group.id, event.target.value);
                        setNotice(`${group.label}: ${event.target.value || 'Any'}.`);
                      }}
                      className="w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2 text-xs text-vx-fg focus:border-vx-accent focus:outline-hidden"
                    >
                      <option value="">Any</option>
                      {group.options.map(([label]) => <option key={label} value={label}>{label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-vx-border bg-vx-base p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-vx-mono text-[8px] font-bold tracking-[0.14em] text-vx-accent">ODDLING PASSPORT · V1</span>
                  <h3 className="mt-1 truncate text-base font-extrabold">{named}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-vx-fg-muted">{picks.oddling_obsession || 'Add a reason to follow so this becomes a creator, not just a face.'}</p>
                </div>
                <button type="button" onClick={save} className={pill(true)}>Save</button>
              </div>
              {chosen.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {chosen.slice(0, 8).map((value, index) => <span key={`${value}-${index}`} className="rounded-full bg-vx-fg/[0.06] px-2 py-1 font-vx-mono text-[8px] text-vx-fg-muted">{value}</span>)}
                  {chosen.length > 8 && <span className="px-1 py-1 font-vx-mono text-[8px] text-vx-fg-faint">+{chosen.length - 8}</span>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vx-border pt-3">
                {saved ? (
                  <>
                    <button type="button" onClick={() => { onChange(saved.picks); setStarterKind(saved.picks.character_type === 'Human' ? 'human' : 'creature'); setNotice('Saved passport loaded.'); }} className={pill(false)}>Load saved</button>
                    <span className="font-vx-mono text-[8px] text-vx-fg-faint">SAVED HERE · {readableTime(saved.savedAt)}</span>
                  </>
                ) : <span className="font-vx-mono text-[8px] text-vx-fg-faint">NOT SAVED · THIS BROWSER ONLY</span>}
              </div>
              {notice && <p role="status" className="mt-2 text-[10px] leading-relaxed text-vx-accent">{notice}</p>}
            </div>

            <p className="text-[10px] leading-relaxed text-vx-fg-faint">The prompt always describes an original adult fictional character, never a real person. Save the strongest result to your Library and reuse it as a visual reference for consistency.</p>
          </div>
        </div>
      )}
    </section>
  );
}
